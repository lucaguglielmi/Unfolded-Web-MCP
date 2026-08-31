import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PRESETS } from "@/lib/model/schemas"
import { createProjectStore, type ProjectStore } from "./useProjectStore"
import {
  createSyncClient,
  diffDesign,
  SESSION_STORAGE_KEY,
  type DesignSlice,
  type SocketLike,
  type SyncClient,
} from "./syncClient"

/* ------------------------------------------------------------- fixtures */

class FakeSocket implements SocketLike {
  sent: Record<string, unknown>[] = []
  closed = false
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>)
  }
  close(): void {
    this.closed = true
  }
  // test drivers
  open(): void {
    this.onopen?.()
  }
  receive(msg: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(msg) })
  }
  sentOfKind(kind: string): Record<string, unknown>[] {
    return this.sent.filter((m) => m.kind === kind)
  }
}

const fakeStorage = (records: Record<string, string> = {}) => ({
  getItem: (k: string) => records[k] ?? null,
  setItem: (k: string, v: string) => {
    records[k] = v
  },
  removeItem: (k: string) => {
    delete records[k]
  },
})

const slice = (store: ProjectStore): DesignSlice => {
  const { form, clay, paperSize, unit } = store.getState()
  return { form, clay, paperSize, unit }
}

let store: ProjectStore
let socket: FakeSocket
let client: SyncClient

/** paired tab, connected, welcomed at the given version */
const startSynced = (version = 3) => {
  client.start()
  socket.open()
  socket.receive({ kind: "welcome", state: slice(store), version, peers: 2 })
}

beforeEach(() => {
  vi.useFakeTimers()
  store = createProjectStore({ now: () => 0 })
  socket = new FakeSocket()
  client = createSyncClient({
    store,
    storage: fakeStorage({ [SESSION_STORAGE_KEY]: JSON.stringify({ sid: "s".repeat(22) }) }),
    createSocket: () => socket,
    randomId: () => "tab-a",
  })
})

afterEach(() => {
  client.stop()
  vi.useRealTimers()
})

/* ----------------------------------------------------------------- tests */

describe("diffDesign", () => {
  it("emits only the changed fields, per slice", () => {
    const prev = slice(store)
    const next: DesignSlice = {
      ...prev,
      form: { ...prev.form, heightMm: 123 },
      unit: "in",
    }
    expect(diffDesign(prev, next)).toEqual({ form: { heightMm: 123 }, unit: "in" })
  })

  it("returns null when nothing changed", () => {
    const s = slice(store)
    expect(diffDesign(s, { ...s })).toBeNull()
  })
})

describe("createSyncClient", () => {
  it("is inert without a stored session", () => {
    const factory = vi.fn(() => socket)
    const unpaired = createSyncClient({
      store,
      storage: fakeStorage(),
      createSocket: factory,
    })
    unpaired.start()
    expect(factory).not.toHaveBeenCalled()
    expect(unpaired.status()).toBe("off")
  })

  it("says hello on open and syncs after welcome", () => {
    client.start()
    expect(client.status()).toBe("connecting")
    socket.open()
    expect(socket.sentOfKind("hello")).toHaveLength(1)
    expect(socket.sentOfKind("hello")[0]).toMatchObject({ clientId: "tab-a", actor: "human" })
    socket.receive({ kind: "welcome", state: slice(store), version: 7, peers: 2 })
    expect(client.status()).toBe("syncing")
    expect(client.peers()).toBe(2)
  })

  it("adopts the session's state on welcome, as one undoable step", () => {
    client.start()
    socket.open()
    socket.receive({
      kind: "welcome",
      state: { ...slice(store), form: PRESETS["tumbler"], unit: "in" },
      version: 1,
      peers: 2,
    })
    expect(store.getState().form.name).toBe("Tapered tumbler")
    expect(store.getState().unit).toBe("in")
    expect(store.getState().undo()).toBe(true)
    expect(store.getState().form.name).toBe("Classic mug")
  })

  it("publishes a local edit as a field-level patch after the debounce", () => {
    startSynced(3)
    store.getState().updateForm({ heightMm: 140 })
    expect(socket.sentOfKind("patch")).toHaveLength(0) // debounced
    vi.runAllTimers()
    const patches = socket.sentOfKind("patch")
    expect(patches).toHaveLength(1)
    expect(patches[0]).toMatchObject({
      baseVersion: 3,
      patches: { form: { heightMm: 140 } },
    })
  })

  it("coalesces rapid edits into one patch", () => {
    startSynced()
    store.getState().updateForm({ heightMm: 140 })
    store.getState().setClay({ shrinkagePct: 14 })
    vi.runAllTimers()
    const patches = socket.sentOfKind("patch")
    expect(patches).toHaveLength(1)
    expect(patches[0].patches).toEqual({
      form: { heightMm: 140 },
      clay: { shrinkagePct: 14 },
    })
  })

  it("applies a peer's patch without echoing it back", () => {
    startSynced(3)
    socket.receive({
      kind: "patch",
      version: 4,
      clientId: "tab-b",
      actor: "agent",
      patches: { form: { heightMm: 155 } },
    })
    expect(store.getState().form.heightMm).toBe(155)
    vi.runAllTimers()
    expect(socket.sentOfKind("patch")).toHaveLength(0)
  })

  it("drops its own echoed patch", () => {
    startSynced(3)
    const before = store.getState().form.heightMm
    socket.receive({
      kind: "patch",
      version: 4,
      clientId: "tab-a",
      patches: { form: { heightMm: 999 } },
    })
    expect(store.getState().form.heightMm).toBe(before)
  })

  it("keeps a concurrent local edit alive across an incoming peer patch", () => {
    startSynced(3)
    store.getState().setClay({ wallThicknessMm: 7 }) // pending, debounced
    socket.receive({
      kind: "patch",
      version: 4,
      clientId: "tab-b",
      patches: { form: { heightMm: 155 } },
    })
    vi.runAllTimers()
    // the peer's field applied AND ours still went out — per-field LWW
    expect(store.getState().form.heightMm).toBe(155)
    const patches = socket.sentOfKind("patch")
    expect(patches).toHaveLength(1)
    expect(patches[0].patches).toEqual({ clay: { wallThicknessMm: 7 } })
  })

  it("re-hellos on a version gap instead of applying blind", () => {
    startSynced(3)
    socket.receive({
      kind: "patch",
      version: 9, // missed 4..8
      clientId: "tab-b",
      patches: { form: { heightMm: 155 } },
    })
    expect(store.getState().form.heightMm).not.toBe(155)
    expect(socket.sentOfKind("hello")).toHaveLength(2)
  })

  it("sanitizes foreign shapes in peer patches", () => {
    startSynced(3)
    socket.receive({
      kind: "patch",
      version: 4,
      clientId: "tab-b",
      patches: { paperSize: "Tabloid", unit: "furlong", nonsense: true },
    })
    expect(store.getState().paperSize).toBe("A4")
    expect(store.getState().unit).toBe("cm")
  })

  it("goes inert when the socket closes (reconnect is item 9)", () => {
    startSynced()
    socket.onclose?.()
    expect(client.status()).toBe("off")
    store.getState().updateForm({ heightMm: 150 })
    vi.runAllTimers()
    expect(socket.sentOfKind("patch")).toHaveLength(0)
  })

  it("tracks presence updates", () => {
    startSynced()
    socket.receive({ kind: "presence", peers: 3 })
    expect(client.peers()).toBe(3)
  })
})
