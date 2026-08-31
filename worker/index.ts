export { SessionDO } from "./sessionDO"
export { PairingDO } from "./pairingDO"

/**
 * Worker entry (docs/live-sync-spec.md §11). Three jobs, in order:
 * www redirect (as before), the /api sync surface, then static assets.
 * Needs `run_worker_first` in wrangler.jsonc — without it, asset-matching
 * requests are served before this script runs.
 */

export interface Env {
  ASSETS: Fetcher
  SESSION: DurableObjectNamespace
  PAIRING: DurableObjectNamespace
}

/** session ids are client-minted 128-bit randoms in url-safe base64/base58ish */
const SID_RE = /^[A-Za-z0-9_-]{16,64}$/
const SESSION_WS_RE = /^\/api\/session\/([^/]+)\/ws$/

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.hostname.startsWith("www.")) {
      url.hostname = url.hostname.slice("www.".length)
      return Response.redirect(url.toString(), 301)
    }

    if (url.pathname.startsWith("/api/")) {
      const ws = url.pathname.match(SESSION_WS_RE)
      if (ws) {
        const sid = ws[1]
        if (!SID_RE.test(sid)) return new Response("bad session id", { status: 400 })
        if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
          return new Response("expected websocket", { status: 426 })
        }
        return env.SESSION.get(env.SESSION.idFromName(sid)).fetch(request)
      }

      if (url.pathname === "/api/pair/claim" && request.method === "POST") {
        let code = ""
        try {
          const body: unknown = await request.json()
          if (typeof body === "object" && body !== null) {
            const raw = (body as Record<string, unknown>).code
            if (typeof raw === "string") code = raw
          }
        } catch {
          /* uniform miss below */
        }
        const stub = env.PAIRING.get(env.PAIRING.idFromName("global"))
        return stub.fetch("https://pairing/claim", {
          method: "POST",
          body: JSON.stringify({
            code,
            // per-IP claim throttle keys off the connecting address
            ip: request.headers.get("CF-Connecting-IP") ?? "unknown",
          }),
        })
      }

      return new Response("not found", { status: 404 })
    }

    return env.ASSETS.fetch(request)
  },
}
