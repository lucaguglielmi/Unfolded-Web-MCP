import { shallow } from "zustand/shallow"
import { sanitizeSharePatches, type SharePatches } from "@/lib/model/shareLink"
import { applyClayPatch, applyFormPatch } from "@/lib/model/applyPatch"
import type { PaperSize } from "@/lib/export/svg"
import type { Unit } from "@/lib/units"
import type { ClaySettings, FormParams } from "@/lib/model/schemas"
import { useProjectStore, type ProjectStore } from "./useProjectStore"

/**
 * Live-sync client core (docs/live-sync-spec.md §7, work item 3): keeps a
 * paired tab's design slice converged with its session's Durable Object
 * over a WebSocket. Wire shape for every state change is SharePatches —
 * the exact contract share links already speak — applied through the same
 * validated `openModel` path, so a peer's edit is one undoable step and
 * can never smuggle out-of-contract values into the store.
 *
 * This module is inert until the tab is paired: without a stored session
 * (`unfolded:session:v1`) start() does nothing, and the app is exactly the
 * offline app. Pairing UI/tools (spec items 5-7) create that record;
 * reconnect backoff and the offline queue arrive with item 9.
 */

/** localStorage record for a paired tab — a NEW key; the frozen existing keys are untouched */
export const SESSION_STORAGE_KEY = "unfolded:session:v1"

export const SYNC_PROTOCOL_VERSION = 1
/** trailing debounce before a local edit is diffed and sent */
const SEND_DEBOUNCE_MS = 250

/** the synced design slice — exactly what persistence.ts persists */
export interface DesignSlice {
  form: FormParams
  clay: ClaySettings
  paperSize: PaperSize
  unit: Unit
}

/**
 * Changed fields of `next` relative to `prev`, as SharePatches — null when
 * nothing differs. Field-level, so two devices editing different knobs in
 * the same instant both win (per-field LWW, spec §7.3).
 */
export function diffDesign(prev: DesignSlice, next: DesignSlice): SharePatches | null {
  const out: SharePatches = {}
  const form: Record<string, unknown> = {}
  for (const k of Object.keys(next.form) as (keyof FormParams)[]) {
    if (next.form[k] !== prev.form[k]) form[k] = next.form[k]
  }
  if (Object.keys(form).length > 0) out.form = form
  const clay: Record<string, unknown> = {}
  for (const k of Object.keys(next.clay) as (keyof ClaySettings)[]) {
    if (next.clay[k] !== prev.clay[k]) clay[k] = next.clay[k]
  }
  if (Object.keys(clay).length > 0) out.clay = clay
  if (next.paperSize !== prev.paperSize) out.paperSize = next.paperSize
  if (next.unit !== prev.unit) out.unit = next.unit
  return Object.keys(out).length > 0 ? out : null
}

/** the subset of WebSocket the client uses — injectable for tests */
export interface SocketLike {
  send(data: string): void
  close(): void
  onopen: (() => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: (() => void) | null
  onerror: (() => void) | null
}

export type SyncStatus = "off" | "connecting" | "syncing"

export interface ClaimResponse {
  ok: boolean
  sid?: string
  /** a rate-limited miss is worth retrying in a minute; an invalid code is not */
  retryable?: boolean
}

export interface SyncClientDeps {
  store?: ProjectStore
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">
  /** open a socket to the session — default: wss to /api/session/:sid/ws */
  createSocket?: (sid: string) => SocketLike
  randomId?: () => string
  /** resolve a pairing code to a session id — default: POST /api/pair/claim */
  claimCode?: (code: string) => Promise<ClaimResponse>
  /** mint a fresh session id — default: 128 crypto-random bits, url-safe */
  newSid?: () => string
}

export interface SyncClient {
  /** connect if this tab has a stored session; no-op otherwise */
  start(): void
  /** disconnect and go inert (the stored session, if any, is kept) */
  stop(): void
  status(): SyncStatus
  /** peers currently in the session, as last reported by the server (self included) */
  peers(): number
  /** whether this tab holds a session (paired), connected or not */
  isPaired(): boolean
  /** ensure this tab has a session (minting one eagerly) and connect */
  pair(): void
  /** mint a pairing code for this tab's session — pairs first if needed */
  mintCode(): Promise<{ code: string; expiresAt: number } | null>
  /** claim a code from another device; on success this tab follows that session */
  joinWithCode(rawCode: string): Promise<{ ok: true } | { ok: false; retryable: boolean }>
  /** leave the session and forget it on this device */
  unpair(): void
  /** notify on status/peers transitions — for useSyncExternalStore */
  subscribe(listener: () => void): () => void
}

function defaultSocket(sid: string): SocketLike {
  const proto = window.location.protocol === "https:" ? "wss" : "ws"
  // a real WebSocket satisfies SocketLike at runtime; the cast only papers
  // over the DOM lib's event-object parameter types being wider than ours
  return new WebSocket(`${proto}://${window.location.host}/api/session/${sid}/ws`) as unknown as SocketLike
}

function defaultRandomId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function defaultNewSid(): string {
  // 128 random bits as url-safe base64 — matches the worker's SID_RE
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")
}

async function defaultClaimCode(code: string): Promise<ClaimResponse> {
  try {
    const response = await fetch("/api/pair/claim", {
      method: "POST",
      body: JSON.stringify({ code }),
    })
    const body: unknown = await response.json().catch(() => null)
    const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {}
    return {
      ok: response.ok && record.ok === true && typeof record.sid === "string",
      sid: typeof record.sid === "string" ? record.sid : undefined,
      retryable: record.retryable === true,
    }
  } catch {
    // no /api here, or the network blinked — worth another try
    return { ok: false, retryable: true }
  }
}

export function createSyncClient({
  store = useProjectStore,
  storage = typeof window === "undefined" ? undefined : window.localStorage,
  createSocket = defaultSocket,
  randomId = defaultRandomId,
  claimCode = defaultClaimCode,
  newSid = defaultNewSid,
}: SyncClientDeps = {}): SyncClient {
  const clientId = randomId()
  let socket: SocketLike | null = null
  let status: SyncStatus = "off"
  let peers = 1
  let version = 0
  let lastSynced: DesignSlice | null = null
  let sendTimer: ReturnType<typeof setTimeout> | undefined
  let unsubscribe: (() => void) | undefined
  const listeners = new Set<() => void>()
  let pendingMint: ((code: { code: string; expiresAt: number } | null) => void) | null = null

  const notify = () => {
    for (const l of listeners) l()
  }
  const setStatus = (next: SyncStatus) => {
    if (status !== next) {
      status = next
      notify()
    }
  }
  const setPeers = (next: number) => {
    if (peers !== next) {
      peers = next
      notify()
    }
  }

  const slice = (): DesignSlice => {
    const { form, clay, paperSize, unit } = store.getState()
    return { form, clay, paperSize, unit }
  }

  const send = (msg: Record<string, unknown>) => {
    try {
      socket?.send(JSON.stringify(msg))
    } catch {
      // a closing socket mid-send — the reconnect path owns recovery
    }
  }

  const storedSid = (): string | null => {
    try {
      const raw = storage?.getItem(SESSION_STORAGE_KEY)
      if (!raw) return null
      const data: unknown = JSON.parse(raw)
      if (typeof data !== "object" || data === null) return null
      const sid = (data as Record<string, unknown>).sid
      return typeof sid === "string" && sid.length > 0 ? sid : null
    } catch {
      return null
    }
  }

  /** adopt a server snapshot (welcome/resync): apply, then move the diff
      baseline in the same frame so the publisher sees nothing to send */
  const adoptServerState = (raw: unknown, newVersion: number) => {
    const patches = sanitizeSharePatches(raw)
    try {
      if (patches) store.getState().openModel(patches)
    } catch {
      // an out-of-contract snapshot can't be adopted — keep the local state
    }
    lastSynced = slice()
    version = newVersion
  }

  const flushLocalEdits = () => {
    if (!lastSynced || status !== "syncing") return
    const patches = diffDesign(lastSynced, slice())
    if (!patches) return
    send({ kind: "patch", patchId: randomId(), baseVersion: version, patches })
    lastSynced = slice()
  }

  const onMessage = (data: unknown) => {
    let msg: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(String(data))
      if (typeof parsed !== "object" || parsed === null) return
      msg = parsed as Record<string, unknown>
    } catch {
      return
    }
    switch (msg.kind) {
      case "welcome":
      case "resync": {
        setStatus("syncing")
        if (typeof msg.peers === "number") setPeers(msg.peers)
        adoptServerState(msg.state, typeof msg.version === "number" ? msg.version : 0)
        // edits made while the snapshot was in flight still go out
        flushLocalEdits()
        break
      }
      case "patch": {
        if (msg.clientId === clientId) {
          // own echo: nothing to apply, but the version bump is ours too —
          // without tracking it, the next peer patch would look like a gap
          if (typeof msg.version === "number") version = Math.max(version, msg.version)
          break
        }
        const newVersion = typeof msg.version === "number" ? msg.version : version + 1
        if (newVersion > version + 1) {
          // missed a broadcast — a fresh hello makes the server re-welcome
          // this client with a full snapshot
          send({ kind: "hello", protocolVersion: SYNC_PROTOCOL_VERSION, clientId, actor: "human" })
          break
        }
        const patches = sanitizeSharePatches(msg.patches)
        if (patches && lastSynced) {
          try {
            store.getState().openModel(patches)
            // Move the baseline by applying the SAME patch to it (through
            // the shared applyPatch semantics) rather than snapshotting the
            // store: the store may also hold a not-yet-flushed local edit,
            // which must keep differing from the baseline so it still goes
            // out — per-field LWW, both sides win (spec §7.3). For the
            // no-pending-edit case the two are identical, which is the
            // echo suppression.
            lastSynced = {
              form: patches.form ? applyFormPatch(lastSynced.form, patches.form) : lastSynced.form,
              clay: patches.clay ? applyClayPatch(lastSynced.clay, patches.clay) : lastSynced.clay,
              paperSize: patches.paperSize ?? lastSynced.paperSize,
              unit: patches.unit ?? lastSynced.unit,
            }
          } catch {
            // out-of-contract values from a peer — patch ignored whole; the
            // version still advances and any real divergence heals on the
            // next gap-triggered resync
          }
        }
        version = newVersion
        break
      }
      case "presence": {
        if (typeof msg.peers === "number") setPeers(msg.peers)
        break
      }
      case "code": {
        if (pendingMint && typeof msg.code === "string" && typeof msg.expiresAt === "number") {
          pendingMint({ code: msg.code, expiresAt: msg.expiresAt })
          pendingMint = null
        }
        break
      }
      default:
      // unknown kinds are ignored — same forgiving posture as share links
    }
  }

  const start = () => {
    const sid = storedSid()
    if (!sid || socket) return
    let s: SocketLike
    try {
      s = createSocket(sid)
    } catch {
      return // no /api in this deployment — the app stays the offline app
    }
    socket = s
    setStatus("connecting")
    s.onopen = () => {
      // state rides along for first-contact bootstrap: an eagerly created
      // session adopts the minting tab's design instead of a default mug
      send({
        kind: "hello",
        protocolVersion: SYNC_PROTOCOL_VERSION,
        clientId,
        actor: "human",
        state: slice(),
      })
    }
    s.onmessage = (ev) => onMessage(ev.data)
    s.onclose = () => {
      if (socket === s) stop() // reconnect/backoff arrives with spec item 9
    }
    s.onerror = () => {
      /* onclose follows and owns teardown */
    }

    unsubscribe = store.subscribe(
      (st) => [st.form, st.clay, st.paperSize, st.unit] as const,
      () => {
        clearTimeout(sendTimer)
        sendTimer = setTimeout(flushLocalEdits, SEND_DEBOUNCE_MS)
      },
      { equalityFn: shallow }
    )
  }

  const stop = () => {
    clearTimeout(sendTimer)
    unsubscribe?.()
    unsubscribe = undefined
    pendingMint?.(null)
    pendingMint = null
    const s = socket
    socket = null
    setStatus("off")
    setPeers(1)
    lastSynced = null
    try {
      s?.close()
    } catch {
      /* already closed */
    }
  }

  const persistSid = (sid: string) => {
    try {
      storage?.setItem(SESSION_STORAGE_KEY, JSON.stringify({ sid }))
    } catch {
      // storage blocked — pairing lasts for this visit only
    }
  }

  const pair = () => {
    if (!storedSid()) persistSid(newSid()) // eager creation (spec §4.2)
    start()
  }

  /** resolves once the session is live, or false after the timeout */
  const whenSyncing = (timeoutMs: number): Promise<boolean> =>
    new Promise((resolve) => {
      if (status === "syncing") return resolve(true)
      const timer = setTimeout(() => {
        off()
        resolve(false)
      }, timeoutMs)
      const off = () => {
        clearTimeout(timer)
        listeners.delete(check)
      }
      const check = () => {
        if (status === "syncing") {
          off()
          resolve(true)
        } else if (status === "off") {
          off()
          resolve(false)
        }
      }
      listeners.add(check)
    })

  const mintCode = async (): Promise<{ code: string; expiresAt: number } | null> => {
    pair()
    if (!(await whenSyncing(8_000))) return null
    return new Promise((resolve) => {
      pendingMint?.(null)
      pendingMint = resolve
      send({ kind: "mint_code" })
      setTimeout(() => {
        if (pendingMint === resolve) {
          pendingMint = null
          resolve(null)
        }
      }, 8_000)
    })
  }

  const joinWithCode = async (
    rawCode: string
  ): Promise<{ ok: true } | { ok: false; retryable: boolean }> => {
    const claimed = await claimCode(rawCode)
    if (!claimed.ok || !claimed.sid) return { ok: false, retryable: claimed.retryable === true }
    stop() // leaving any current session — the claimer follows the minted one
    persistSid(claimed.sid)
    start()
    return { ok: true }
  }

  const unpair = () => {
    stop()
    try {
      storage?.removeItem(SESSION_STORAGE_KEY)
    } catch {
      /* nothing to forget */
    }
  }

  return {
    start,
    stop,
    status: () => status,
    peers: () => peers,
    isPaired: () => storedSid() !== null,
    pair,
    mintCode,
    joinWithCode,
    unpair,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/** App-boot entry point: one shared client, connected only when paired. */
export const liveSync = createSyncClient()

export function startLiveSync(): void {
  if (typeof window === "undefined") return
  liveSync.start()
}
