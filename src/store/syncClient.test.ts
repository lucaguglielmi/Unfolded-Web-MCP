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

  it("reconnects with backoff after a lost socket", () => {
    const sockets: FakeSocket[] = []
    const fresh = createSyncClient({
      store,
      storage: fakeStorage({ [SESSION_STORAGE_KEY]: JSON.stringify({ sid: "s".repeat(22) }) }),
      createSocket: () => {
        const s = new FakeSocket()
        sockets.push(s)
        return s
      },
      randomId: () => "tab-a",
    })
    fresh.start()
    sockets[0].open()
    sockets[0].receive({ kind: "welcome", state: slice(store), version: 1, peers: 2 })
    expect(fresh.status()).toBe("syncing")

    sockets[0].onclose?.() // the network dropped, not the user
    expect(fresh.status()).toBe("connecting") // lost, not off
    expect(fresh.peers()).toBe(1) // only confirmed facts
    vi.advanceTimersByTime(1_500) // first retry: ~1s + jitter
    expect(sockets).toHaveLength(2)
    sockets[1].open()
    sockets[1].receive({ kind: "welcome", state: slice(store), version: 5, peers: 2 })
    expect(fresh.status()).toBe("syncing")
    fresh.stop()
  })

  it("sends edits made while offline after the reconnect welcome (local wins per-field)", () => {
    const sockets: FakeSocket[] = []
    const fresh = createSyncClient({
      store,
      storage: fakeStorage({ [SESSION_STORAGE_KEY]: JSON.stringify({ sid: "s".repeat(22) }) }),
      createSocket: () => {
        const s = new FakeSocket()
        sockets.push(s)
        return s
      },
      randomId: () => "tab-a",
    })
    fresh.start()
    sockets[0].open()
    sockets[0].receive({ kind: "welcome", state: slice(store), version: 1, peers: 2 })

    sockets[0].onclose?.()
    store.getState().updateForm({ heightMm: 177 }) // offline edit
    vi.advanceTimersByTime(1_500)
    sockets[1].open()
    // meanwhile a peer changed the clay on the server
    const serverState = { ...slice(store), form: { ...slice(store).form, heightMm: 100 }, clay: { shrinkagePct: 8, wallThicknessMm: 4 } }
    sockets[1].receive({ kind: "welcome", state: serverState, version: 9, peers: 2 })
    // the peer's clay landed, AND the offline height survived on top…
    expect(store.getState().clay.shrinkagePct).toBe(8)
    expect(store.getState().form.heightMm).toBe(177)
    // …and went out to the session as a patch
    const patches = sockets[1].sentOfKind("patch")
    expect(patches).toHaveLength(1)
    expect(patches[0].patches).toEqual({ form: { heightMm: 177 } })
    fresh.stop()
  })

  it("stop() means left, not lost — no reconnect is scheduled", () => {
    startSynced()
    client.stop()
    expect(client.status()).toBe("off")
    vi.advanceTimersByTime(60_000)
    expect(client.status()).toBe("off")
    store.getState().updateForm({ heightMm: 150 })
    vi.advanceTimersByTime(1_000)
    expect(socket.sentOfKind("patch")).toHaveLength(0)
  })

  it("tracks presence updates", () => {
    startSynced()
    socket.receive({ kind: "presence", peers: 3 })
    expect(client.peers()).toBe(3)
  })
})

describe("pairing operations", () => {
  it("pair() mints and persists a sid for an unpaired tab, then connects", () => {
    const records: Record<string, string> = {}
    const factory = vi.fn(() => socket)
    const fresh = createSyncClient({
      store,
      storage: fakeStorage(records),
      createSocket: factory,
      randomId: () => "tab-a",
      newSid: () => "minted-sid-1234567890",
    })
    expect(fresh.isPaired()).toBe(false)
    fresh.pair()
    expect(JSON.parse(records[SESSION_STORAGE_KEY]).sid).toBe("minted-sid-1234567890")
    expect(factory).toHaveBeenCalledWith("minted-sid-1234567890")
    expect(fresh.isPaired()).toBe(true)
    fresh.stop()
  })

  it("mintCode() pairs, waits for the session, and resolves the server's code", async () => {
    client.start()
    socket.open()
    const minted = client.mintCode()
    socket.receive({ kind: "welcome", state: slice(store), version: 1, peers: 1 })
    await Promise.resolve()
    expect(socket.sentOfKind("mint_code")).toHaveLength(1)
    socket.receive({ kind: "code", code: "K7F3QP", expiresAt: 999_999 })
    await expect(minted).resolves.toEqual({ code: "K7F3QP", expiresAt: 999_999 })
  })

  it("mintToken() resolves the server's URL join token", async () => {
    client.start()
    socket.open()
    const minted = client.mintToken()
    socket.receive({ kind: "welcome", state: slice(store), version: 1, peers: 1 })
    await Promise.resolve()
    expect(socket.sentOfKind("mint_token")).toHaveLength(1)
    socket.receive({ kind: "token", token: "u".repeat(32), expiresAt: 999_999 })
    await expect(minted).resolves.toEqual({ token: "u".repeat(32), expiresAt: 999_999 })
  })

  it("joinWithCode() claims, follows the new session, and reports misses", async () => {
    const records: Record<string, string> = {}
    const sockets: FakeSocket[] = []
    const claim = vi.fn(async (code: string) =>
      code === "GOODIE" ? { ok: true, sid: "claimed-sid-1234567890" } : { ok: false, retryable: false }
    )
    const fresh = createSyncClient({
      store,
      storage: fakeStorage(records),
      createSocket: () => {
        const s = new FakeSocket()
        sockets.push(s)
        return s
      },
      claimCode: claim,
    })
    await expect(fresh.joinWithCode("nope")).resolves.toEqual({ ok: false, retryable: false })
    expect(records[SESSION_STORAGE_KEY]).toBeUndefined()
    await expect(fresh.joinWithCode("GOODIE")).resolves.toEqual({ ok: true })
    expect(JSON.parse(records[SESSION_STORAGE_KEY]).sid).toBe("claimed-sid-1234567890")
    expect(sockets).toHaveLength(1)
    fresh.stop()
  })

  it("unpair() disconnects and forgets the session", () => {
    const records: Record<string, string> = {
      [SESSION_STORAGE_KEY]: JSON.stringify({ sid: "x".repeat(22) }),
    }
    const fresh = createSyncClient({
      store,
      storage: fakeStorage(records),
      createSocket: () => socket,
    })
    fresh.start()
    fresh.unpair()
    expect(records[SESSION_STORAGE_KEY]).toBeUndefined()
    expect(fresh.isPaired()).toBe(false)
    expect(socket.closed).toBe(true)
  })

  it("a minted-but-never-claimed session forgets itself after the code's lifetime", () => {
    const records: Record<string, string> = {}
    const fresh = createSyncClient({
      store,
      storage: fakeStorage(records),
      createSocket: () => socket,
      newSid: () => "solo-sid-1234567890ab",
    })
    fresh.pair() // e.g. an agent called start_pairing
    socket.open()
    socket.receive({ kind: "welcome", state: slice(store), version: 1, peers: 1 })
    expect(fresh.isPaired()).toBe(true)
    expect(fresh.everPeered()).toBe(false)
    vi.advanceTimersByTime(6 * 60_000 + 1_000) // nobody ever entered the code
    expect(fresh.isPaired()).toBe(false)
    expect(fresh.status()).toBe("off")
    expect(records[SESSION_STORAGE_KEY]).toBeUndefined()
  })

  it("a session that has seen a peer survives being alone indefinitely", () => {
    const records: Record<string, string> = {
      [SESSION_STORAGE_KEY]: JSON.stringify({ sid: "x".repeat(22) }),
    }
    const fresh = createSyncClient({
      store,
      storage: fakeStorage(records),
      createSocket: () => socket,
    })
    fresh.start()
    socket.open()
    socket.receive({ kind: "welcome", state: slice(store), version: 1, peers: 2 })
    expect(fresh.everPeered()).toBe(true)
    expect(JSON.parse(records[SESSION_STORAGE_KEY]).everPeered).toBe(true)
    socket.receive({ kind: "presence", peers: 1 }) // the other device left
    vi.advanceTimersByTime(60 * 60_000)
    expect(fresh.isPaired()).toBe(true)
    expect(fresh.status()).toBe("syncing")
    fresh.stop()
  })

  it("everPeered survives a reload once proven", () => {
    const records: Record<string, string> = {
      [SESSION_STORAGE_KEY]: JSON.stringify({ sid: "x".repeat(22), everPeered: true }),
    }
    const fresh = createSyncClient({ store, storage: fakeStorage(records), createSocket: () => socket })
    fresh.start()
    expect(fresh.everPeered()).toBe(true)
    fresh.stop()
  })

  it("entering a code counts as proof of another device", async () => {
    const records: Record<string, string> = {}
    const fresh = createSyncClient({
      store,
      storage: fakeStorage(records),
      createSocket: () => socket,
      claimCode: async () => ({ ok: true, sid: "claimed-sid-1234567890" }),
    })
    await fresh.joinWithCode("K7F3QP")
    expect(JSON.parse(records[SESSION_STORAGE_KEY]).everPeered).toBe(true)
    expect(fresh.everPeered()).toBe(true)
    fresh.stop()
  })

  it("notifies subscribers on status and peer transitions", () => {
    const seen: string[] = []
    client.subscribe(() => seen.push(`${client.status()}:${client.peers()}`))
    startSynced()
    socket.receive({ kind: "presence", peers: 3 })
    client.stop()
    expect(seen).toEqual(["connecting:1", "syncing:1", "syncing:2", "syncing:3", "off:3", "off:1"])
  })
})
