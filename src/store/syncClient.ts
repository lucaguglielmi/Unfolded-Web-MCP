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
/** reconnect backoff bounds — 1 s doubling to 30 s, jittered */
const RECONNECT_MIN_MS = 1_000
const RECONNECT_MAX_MS = 30_000
/**
 * A session that has NEVER seen a second device forgets itself after this
 * long connected alone — comfortably past a pairing code's 5-minute TTL.
 * Minting a code creates the session eagerly (so the code outlives the
 * minting tab), but an expired, never-claimed code must not leave the tab
 * claiming "paired" forever.
 */
const SOLO_GRACE_MS = 6 * 60_000

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
  /** another device has actually been in this session at some point */
  everPeered(): boolean
  /** whether this tab holds a session (paired), connected or not */
  isPaired(): boolean
  /** ensure this tab has a session (minting one eagerly) and connect */
  pair(): void
  /** mint a pairing code for this tab's session — pairs first if needed */
  mintCode(): Promise<{ code: string; expiresAt: number } | null>
  /** mint a single-use URL join token (codes' URL-borne sibling, longer TTL) */
  mintToken(): Promise<{ token: string; expiresAt: number } | null>
  /** claim a code from another device; on success this tab follows that session */
  joinWithCode(rawCode: string): Promise<{ ok: true } | { ok: false; retryable: boolean }>
  /** leave the session and forget it on this device */
  unpair(): void
  /** notify on status/peers transitions — for useSyncExternalStore */
  subscribe(listener: () => void): () => void
  /** resolves true once the session is live, false on timeout/disconnect */
  whenSyncing(timeoutMs: number): Promise<boolean>
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
  /** true between start() and stop() — a lost socket reconnects only while set */
  let wantConnected = false
  /** another device has been in this session at some point (persisted) */
  let everPeered = false
  let soloTimer: ReturnType<typeof setTimeout> | undefined
  let reconnectDelay = RECONNECT_MIN_MS
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let removeWakeListeners: (() => void) | undefined
  const listeners = new Set<() => void>()
  let pendingMint: ((code: { code: string; expiresAt: number } | null) => void) | null = null
  let pendingToken: ((token: { token: string; expiresAt: number } | null) => void) | null = null

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
    if (next > 1 && !everPeered) {
      // the pairing is now proven real — remember it across visits
      everPeered = true
      clearTimeout(soloTimer)
      const sid = storedSid()
      if (sid) persistRecord(sid, true)
    }
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

  const storedRecord = (): { sid: string; everPeered: boolean } | null => {
    try {
      const raw = storage?.getItem(SESSION_STORAGE_KEY)
      if (!raw) return null
      const data: unknown = JSON.parse(raw)
      if (typeof data !== "object" || data === null) return null
      const record = data as Record<string, unknown>
      if (typeof record.sid !== "string" || record.sid.length === 0) return null
      return { sid: record.sid, everPeered: record.everPeered === true }
    } catch {
      return null
    }
  }

  const storedSid = (): string | null => storedRecord()?.sid ?? null

  /**
   * Adopt a server snapshot (welcome/resync): apply it, then move the diff
   * baseline in the same frame so the publisher sees nothing to send. Edits
   * made while disconnected survive: the baseline is kept across a lost
   * socket, so the delta the potter built up offline is re-applied ON TOP
   * of the server state (per-field local-wins, spec §7.5) and the follow-up
   * flush sends it to the peers. A first join has no baseline — there the
   * session's state wins whole, which is the §4.3 adopt rule.
   */
  const adoptServerState = (raw: unknown, newVersion: number) => {
    const offlineDelta = lastSynced ? diffDesign(lastSynced, slice()) : null
    const patches = sanitizeSharePatches(raw)
    try {
      if (patches) store.getState().openModel(patches)
    } catch {
      // an out-of-contract snapshot can't be adopted — keep the local state
    }
    lastSynced = slice()
    version = newVersion
    if (offlineDelta) {
      try {
        store.getState().openModel(offlineDelta)
      } catch {
        // the offline edit no longer applies — the server state stands
      }
    }
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
        reconnectDelay = RECONNECT_MIN_MS // the link is healthy again
        if (typeof msg.peers === "number") setPeers(msg.peers)
        if (!everPeered) {
          // connected alone with no history of a peer: give any minted code
          // its full lifetime, then quietly forget the session
          clearTimeout(soloTimer)
          soloTimer = setTimeout(() => {
            if (!everPeered) unpair()
          }, SOLO_GRACE_MS)
        }
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
      case "token": {
        if (pendingToken && typeof msg.token === "string" && typeof msg.expiresAt === "number") {
          pendingToken({ token: msg.token, expiresAt: msg.expiresAt })
          pendingToken = null
        }
        break
      }
      default:
      // unknown kinds are ignored — same forgiving posture as share links
    }
  }

  const connect = () => {
    const sid = storedSid()
    if (!sid || socket) return
    let s: SocketLike
    try {
      s = createSocket(sid)
    } catch {
      // no /api in this deployment — retry on the slow cadence, the app
      // stays fully usable offline in the meantime
      scheduleReconnect()
      return
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
      if (socket !== s) return
      socket = null
      setPeers(1)
      if (wantConnected) {
        // lost, not left: keep the baseline (offline edits diff against
        // it on the next welcome) and come back on backoff
        setStatus("connecting")
        scheduleReconnect()
      }
    }
    s.onerror = () => {
      /* onclose follows and owns teardown */
    }
  }

  const scheduleReconnect = () => {
    if (!wantConnected) return
    clearTimeout(reconnectTimer)
    const jitter = 1 + Math.random() * 0.3
    reconnectTimer = setTimeout(connect, reconnectDelay * jitter)
    reconnectDelay = Math.min(RECONNECT_MAX_MS, reconnectDelay * 2)
  }

  /** mobile Chrome freezes background sockets — every return to the tab
      (focus, visibility, network back) is an immediate reconnect check */
  const wake = () => {
    if (!wantConnected || socket) return
    clearTimeout(reconnectTimer)
    reconnectDelay = RECONNECT_MIN_MS
    connect()
  }

  const start = () => {
    const record = storedRecord()
    if (!record || wantConnected) return
    everPeered = record.everPeered
    wantConnected = true
    unsubscribe ??= store.subscribe(
      (st) => [st.form, st.clay, st.paperSize, st.unit] as const,
      () => {
        clearTimeout(sendTimer)
        sendTimer = setTimeout(flushLocalEdits, SEND_DEBOUNCE_MS)
      },
      { equalityFn: shallow }
    )
    if (!removeWakeListeners && typeof window !== "undefined") {
      const onVisible = () => {
        if (document.visibilityState === "visible") wake()
      }
      window.addEventListener("focus", wake)
      window.addEventListener("online", wake)
      document.addEventListener("visibilitychange", onVisible)
      removeWakeListeners = () => {
        window.removeEventListener("focus", wake)
        window.removeEventListener("online", wake)
        document.removeEventListener("visibilitychange", onVisible)
      }
    }
    connect()
  }

  const stop = () => {
    wantConnected = false
    clearTimeout(sendTimer)
    clearTimeout(reconnectTimer)
    clearTimeout(soloTimer)
    unsubscribe?.()
    unsubscribe = undefined
    removeWakeListeners?.()
    removeWakeListeners = undefined
    pendingMint?.(null)
    pendingMint = null
    pendingToken?.(null)
    pendingToken = null
    const s = socket
    socket = null
    setStatus("off")
    setPeers(1)
    lastSynced = null
    reconnectDelay = RECONNECT_MIN_MS
    try {
      s?.close()
    } catch {
      /* already closed */
    }
  }

  const persistRecord = (sid: string, peered: boolean) => {
    try {
      storage?.setItem(SESSION_STORAGE_KEY, JSON.stringify({ sid, everPeered: peered }))
    } catch {
      // storage blocked — pairing lasts for this visit only
    }
  }

  const pair = () => {
    if (!storedSid()) persistRecord(newSid(), false) // eager creation (spec §4.2)
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

  /** mint a URL-borne join token for this tab's session — pairs first if needed */
  const mintToken = async (): Promise<{ token: string; expiresAt: number } | null> => {
    pair()
    if (!(await whenSyncing(8_000))) return null
    return new Promise((resolve) => {
      pendingToken?.(null)
      pendingToken = resolve
      send({ kind: "mint_token" })
      setTimeout(() => {
        if (pendingToken === resolve) {
          pendingToken = null
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
    // entering a code IS proof another device exists — this pairing is real
    persistRecord(claimed.sid, true)
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
    everPeered: () => everPeered,
    isPaired: () => storedSid() !== null,
    pair,
    mintCode,
    mintToken,
    joinWithCode,
    unpair,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    whenSyncing,
  }
}

/** App-boot entry point: one shared client, connected only when paired. */
export const liveSync = createSyncClient()

export function startLiveSync(): void {
  if (typeof window === "undefined") return
  liveSync.start()
}
