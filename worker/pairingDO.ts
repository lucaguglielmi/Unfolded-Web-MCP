import { DurableObject } from "cloudflare:workers"
import { PairingCore, type PairingSnapshot } from "./pairingCore"
import type { Env } from "./index"

/**
 * The one global pairing registry (docs/live-sync-spec.md §3, §11): active
 * codes only, resolved and burned atomically — which is exactly why this
 * is a single Durable Object and not KV. Reached only over service
 * bindings/stubs from the worker and SessionDOs, never directly from the
 * internet.
 */

const STORAGE_KEY = "codes"

export class PairingDO extends DurableObject<Env> {
  private core: PairingCore | null = null

  private async loadCore(): Promise<PairingCore> {
    if (!this.core) {
      const stored = await this.ctx.storage.get<PairingSnapshot>(STORAGE_KEY)
      this.core = new PairingCore(stored ?? undefined)
    }
    return this.core
  }

  private async persist(core: PairingCore): Promise<void> {
    await this.ctx.storage.put(STORAGE_KEY, core.snapshot())
    const next = core.nextExpiry()
    if (next !== null) await this.ctx.storage.setAlarm(next)
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (request.method !== "POST") return Response.json({ ok: false }, { status: 405 })
    let body: Record<string, unknown>
    try {
      const parsed: unknown = await request.json()
      if (typeof parsed !== "object" || parsed === null) throw new Error("not an object")
      body = parsed as Record<string, unknown>
    } catch {
      return Response.json({ ok: false }, { status: 400 })
    }
    const core = await this.loadCore()

    if (url.pathname === "/mint") {
      const sid = body.sid
      if (typeof sid !== "string" || sid.length === 0) {
        return Response.json({ ok: false }, { status: 400 })
      }
      const minted = core.mint(sid, Date.now())
      await this.persist(core)
      return Response.json({ ok: true, ...minted })
    }

    if (url.pathname === "/claim") {
      const code = typeof body.code === "string" ? body.code : ""
      const ip = typeof body.ip === "string" && body.ip.length > 0 ? body.ip : "unknown"
      const result = core.claim(code, ip, Date.now())
      if (!result.ok) {
        // uniform miss: rate-limited and invalid share one status so the
        // endpoint is no oracle; the retry hint is the only difference
        return Response.json(
          { ok: false, retryable: result.reason === "rate_limited" },
          { status: 404 }
        )
      }
      await this.persist(core)
      return Response.json({ ok: true, sid: result.sid })
    }

    return Response.json({ ok: false }, { status: 404 })
  }

  override async alarm(): Promise<void> {
    const core = await this.loadCore()
    core.sweep(Date.now())
    await this.persist(core)
  }
}
