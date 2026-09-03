/**
 * Security headers for every non-WebSocket response.
 *
 * Evaluated against what the app actually does, not blindly added:
 * - scripts are all same-origin bundles (index.html's theme-init script
 *   moved to /theme-init.js so `script-src 'self'` holds with no hashes),
 *   plus Cloudflare's Web Analytics beacon, which Cloudflare injects into
 *   every HTML response and which reports to cloudflareinsights.com;
 * - styles need 'unsafe-inline' (React/three inject inline styles, and
 *   index.html carries the boot-loader style block);
 * - images include data:/blob: (QR data URLs, the preview JPEG snapshot);
 * - connect-src pins WebSockets to this host explicitly because older
 *   Safari does not extend 'self' to ws:/wss:, and Safari is exactly the
 *   browser the live-sync story promises to work in;
 * - workers allow blob: for three.js/bundler-spawned workers;
 * - frame-ancestors is deliberately NOT set: ChatGPT's in-app browser and
 *   other agent hosts may embed the page, and blocking them would break
 *   the product's primary path.
 *
 * `Permissions-Policy: tools=(self)` from the spec is skipped — "tools" is
 * not a registered policy-controlled feature; the denied list below covers
 * the powerful features this app never uses.
 */
export function securityHeaders(requestUrl: URL): Record<string, string> {
  const host = requestUrl.host
  const csp = [
    "default-src 'self'",
    // The profiler guide is intentionally self-contained and has one inline
    // clipboard handler. Keep its exact hash here so the deployed guide works
    // without weakening script-src to unsafe-inline.
    "script-src 'self' 'sha256-E/t7skD8zO/p7pLoNjuqxsVh7kDieOfw8/z60LMNIbQ=' https://static.cloudflareinsights.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' wss://${host} ws://${host} https://cloudflareinsights.com`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ")
  return {
    "Content-Security-Policy": csp,
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "Origin-Agent-Cluster": "?1",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Strict-Transport-Security": "max-age=31536000",
  }
}

/** Clone a response with the security headers applied (responses from the
    assets binding are immutable). Never call on a 101/WebSocket response. */
export function withSecurityHeaders(response: Response, requestUrl: URL): Response {
  const out = new Response(response.body, response)
  for (const [name, value] of Object.entries(securityHeaders(requestUrl))) {
    out.headers.set(name, value)
  }
  return out
}
