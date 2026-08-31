/**
 * webmcp-profiler · boot gate — zero cost until asked for.
 *
 * Call once, first thing at boot (before any tool registration starts):
 *
 *   ?perf=1        turn profiling on (persists via localStorage)
 *   ?perf=overlay  on, with the floating panel open
 *   ?perf=0        turn it off again
 *
 * Persistence matters because most apps rewrite their URL (this one
 * live-tracks the design in the address bar), and because the tab you
 * most want to profile — a hidden agent browser — can only be steered by
 * URL once, via a link the agent opens.
 */

import { attachProfiler } from "./index"

export const PERF_STORAGE_KEY = "webmcp-perf:mode"
const STORAGE_KEY = PERF_STORAGE_KEY

export function maybeAttachProfiler(): void {
  try {
    const requested = new URLSearchParams(window.location.search).get("perf")
    if (requested === "0") window.localStorage.removeItem(STORAGE_KEY)
    else if (requested !== null && requested !== "") window.localStorage.setItem(STORAGE_KEY, requested)

    const mode = requested === "0" ? null : (requested || window.localStorage.getItem(STORAGE_KEY))
    if (!mode || mode === "0") return

    attachProfiler({ overlay: mode === "overlay" })
    console.info(
      "[webmcp-perf] profiling on — __webmcpPerf.table() / .report() / .overlay(); ?perf=0 to disable"
    )
  } catch {
    /* storage or URL access blocked — profiling simply stays off */
  }
}
