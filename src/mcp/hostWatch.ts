/**
 * The host watch: how often the page looks for a WebMCP registry
 * (docs/webmcp-tool-performance-spec.md §9). Hosts differ wildly in WHEN
 * they expose the API — extension shims shortly after load, in-app agent
 * browsers (ChatGPT's) only when the person first engages the agent,
 * possibly minutes in. So the watch never slows down and never stops:
 *
 *  - visible document: every HOST_POLL_MS for the life of the tab. The
 *    steady-state cost is three property reads per tick;
 *  - hidden document: at most every HIDDEN_POLL_MS. Browsers throttle
 *    hidden timers on their own, and an agent browser that never reports
 *    itself visible still registers — nothing waits for a focus event
 *    that may never come;
 *  - `visibilitychange` and `focus` re-check immediately.
 *
 * Pure scheduling, no React: `attempt` is whatever the caller wants run.
 */

export const HOST_POLL_MS = 500
export const HIDDEN_POLL_MS = 3_000

export interface HostWatchOptions {
  attempt: () => unknown
  /** injectable for tests; defaults to `document.hidden` */
  isHidden?: () => boolean
  now?: () => number
}

/** start the watch; returns the function that stops it */
export function startHostWatch({
  attempt,
  isHidden = () => document.hidden,
  now = Date.now,
}: HostWatchOptions): () => void {
  // the caller runs the first attempt itself, right before starting the watch
  let lastAttemptAt = now()
  const run = () => {
    lastAttemptAt = now()
    void attempt()
  }
  const timer = window.setInterval(() => {
    if (isHidden() && now() - lastAttemptAt < HIDDEN_POLL_MS) return
    run()
  }, HOST_POLL_MS)

  document.addEventListener("visibilitychange", run)
  window.addEventListener("focus", run)

  return () => {
    window.clearInterval(timer)
    document.removeEventListener("visibilitychange", run)
    window.removeEventListener("focus", run)
  }
}
