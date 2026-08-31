import { DurableObject } from "cloudflare:workers"
import { SessionCore, type SessionSnapshot } from "./sessionCore"
import type { Env } from "./index"

/**
 * One Durable Object per live session (docs/live-sync-spec.md §3, §11).
 * Uses the WebSocket Hibernation API, so an idle session costs nothing:
 * everything a wake needs is either in storage (state, version) or in each
 * socket's serialized attachment (clientId, actor) — no in-memory maps
 * that hibernation would lose.
 */

const MAX_SOCKETS = 16
const MAX_FRAME_BYTES = 8 * 1024
const MAX_MSGS_PER_SECOND = 20
/** a session with no connections for this long deletes itself */
export const SESSION_IDLE_TTL_MS = 30 * 24 * 60 * 60 * 1000

const STORAGE_KEY = "session"

interface StoredSession extends SessionSnapshot {
  updatedAt: number
}

interface Attachment {
  clientId: string
  actor: "human" | "agent"
  /** sliding-window message timestamps for the per-socket rate limit */
  recent: number[]
}

export class SessionDO extends DurableObject<Env> {
  private core: SessionCore | null = null

  private async loadCore(): Promise<SessionCore> {
    if (!this.core) {
      const stored = await this.ctx.storage.get<StoredSession>(STORAGE_KEY)
      this.core = new SessionCore(stored ?? undefined)
    }
    return this.core
  }

  private async persist(): Promise<void> {
    if (!this.core) return
    const record: StoredSession = { ...this.core.snapshot(), updatedAt: Date.now() }
    await this.ctx.storage.put(STORAGE_KEY, record)
    await this.ctx.storage.setAlarm(Date.now() + SESSION_IDLE_TTL_MS)
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("expected websocket", { status: 426 })
    }
    if (this.ctx.getWebSockets().length >= MAX_SOCKETS) {
      return new Response("session full", { status: 503 })
    }
    await this.loadCore()
    const pair = new WebSocketPair()
    this.ctx.acceptWebSocket(pair[1])
    // renews on every accept, so an active session never hits its idle alarm
    await this.persist()
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string" || message.length > MAX_FRAME_BYTES) {
      this.fail(ws, "unsupported frame")
      return
    }
    const attachment = (ws.deserializeAttachment() as Attachment | null) ?? {
      clientId: "",
      actor: "human" as const,
      recent: [],
    }
    const now = Date.now()
    attachment.recent = attachment.recent.filter((t) => now - t < 1_000)
    if (attachment.recent.length >= MAX_MSGS_PER_SECOND) {
      this.fail(ws, "too many messages")
      return
    }
    attachment.recent.push(now)

    let msg: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(message)
      if (typeof parsed !== "object" || parsed === null) return
      msg = parsed as Record<string, unknown>
    } catch {
      return // not JSON — ignore, same forgiving posture as the client
    }

    const core = await this.loadCore()
    switch (msg.kind) {
      case "hello": {
        attachment.clientId = typeof msg.clientId === "string" ? msg.clientId : ""
        attachment.actor = msg.actor === "agent" ? "agent" : "human"
        ws.serializeAttachment(attachment)
        const adopted = core.bootstrap(msg.state)
        this.send(ws, {
          kind: "welcome",
          state: core.state,
          version: core.version,
          peers: this.ctx.getWebSockets().length,
        })
        this.broadcastPresence(ws)
        if (adopted) await this.persist()
        return
      }
      case "patch": {
        ws.serializeAttachment(attachment)
        const result = core.apply(msg.patches)
        if (!result.ok) {
          this.send(ws, { kind: "error", code: "invalid_patch", message: result.error })
          return
        }
        // broadcast to ALL (sender included): the echo is how the sender
        // learns the version its own edit landed at
        const broadcast = {
          kind: "patch",
          version: result.version,
          patches: result.patches,
          clientId: attachment.clientId,
          actor: attachment.actor,
        }
        for (const peer of this.ctx.getWebSockets()) this.send(peer, broadcast)
        await this.persist()
        return
      }
      case "mint_code": {
        ws.serializeAttachment(attachment)
        const sid = this.ctx.id.name
        if (!sid) {
          this.send(ws, { kind: "error", code: "unaddressable", message: "session has no name" })
          return
        }
        const stub = this.env.PAIRING.get(this.env.PAIRING.idFromName("global"))
        const response = await stub.fetch("https://pairing/mint", {
          method: "POST",
          body: JSON.stringify({ sid }),
        })
        if (!response.ok) {
          this.send(ws, { kind: "error", code: "mint_failed", message: "could not mint a code" })
          return
        }
        const minted: unknown = await response.json()
        this.send(ws, { kind: "code", ...(minted as Record<string, unknown>) })
        return
      }
      case "bye": {
        ws.close(1000, "bye")
        return
      }
      default:
      // unknown kinds are ignored
    }
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    this.broadcastPresence(ws)
    await this.persist() // restart the idle clock from the last departure
  }

  override async alarm(): Promise<void> {
    if (this.ctx.getWebSockets().length > 0) {
      await this.persist() // still in use — push the deadline out
      return
    }
    const stored = await this.ctx.storage.get<StoredSession>(STORAGE_KEY)
    if (!stored || Date.now() - stored.updatedAt >= SESSION_IDLE_TTL_MS) {
      await this.ctx.storage.deleteAll() // also clears the alarm
      this.core = null
      return
    }
    await this.ctx.storage.setAlarm(stored.updatedAt + SESSION_IDLE_TTL_MS)
  }

  private send(ws: WebSocket, msg: Record<string, unknown>): void {
    try {
      ws.send(JSON.stringify(msg))
    } catch {
      // socket already gone — its close handler owns cleanup
    }
  }

  private broadcastPresence(except: WebSocket): void {
    const sockets = this.ctx.getWebSockets()
    const msg = { kind: "presence", peers: sockets.length }
    for (const peer of sockets) {
      if (peer !== except) this.send(peer, msg)
    }
  }

  private fail(ws: WebSocket, reason: string): void {
    this.send(ws, { kind: "error", code: "protocol", message: reason })
    try {
      ws.close(1008, reason)
    } catch {
      /* already closed */
    }
  }
}
