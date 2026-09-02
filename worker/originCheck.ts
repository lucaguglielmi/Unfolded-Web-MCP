/**
 * Browser origin guard for the sync surface (docs/live-sync-spec.md §12).
 *
 * Browsers always attach an Origin header to WebSocket upgrades and
 * cross-origin POSTs, so rejecting a mismatched Origin stops a malicious
 * page from driving a visitor's browser at this API. Requests WITHOUT an
 * Origin header pass: they come from non-browser clients (curl, the e2e
 * smoke suite), which can fabricate any header anyway — for them the
 * protection remains capability secrecy (sids, codes, and tokens are
 * unguessable, single-use, and short-lived).
 *
 * The comparison is hostname-only, so `wrangler dev` on any localhost port
 * and the production custom domain both pass without configuration.
 */
export function originAllowed(originHeader: string | null, requestUrl: URL): boolean {
  if (originHeader === null) return true
  let origin: URL
  try {
    origin = new URL(originHeader)
  } catch {
    // "null" (sandboxed iframe) or malformed — not a first-party page
    return false
  }
  return origin.hostname === requestUrl.hostname
}
