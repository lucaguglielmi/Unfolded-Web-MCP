/**
 * The boot gate. Call it first thing at boot, before any tool
 * registration starts; it costs a URL parse and one storage read when
 * the gate stays closed.
 *
 *   ?perf=1        profiling on for this origin (persists in localStorage)
 *   ?perf=overlay  on, with the floating panel open
 *   ?perf=0        off again
 *
 * Persistence matters because apps rewrite their URLs and because a
 * hidden agent browser can be steered by URL only once, through a link
 * the agent opens.
 */

import { resolveGate, type GateOptions } from "./gate"
import { announce, attachProfiler, type GateConfig, type Profiler } from "./index"
import { warnRejected } from "./attach-lazy"

export { PERF_STORAGE_KEY, type PerfMode } from "./gate"
export { maybeAttachProfilerLazy } from "./attach-lazy"
export type { GateConfig }

/** Open the gate if the URL or storage asks for it; returns the profiler, or null when it stayed closed. */
export function maybeAttachProfiler(config: GateConfig = {}): Profiler | null {
  const { mode, rejected } = resolveGate(config as GateOptions)
  if (rejected !== null) warnRejected(config.param ?? "perf", rejected)
  if (!mode) return null
  const profiler = attachProfiler({ ...config, overlay: mode === "overlay" || config.overlay === true })
  announce(profiler, config)
  return profiler
}
