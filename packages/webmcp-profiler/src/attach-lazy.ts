/**
 * The boot gate with the core loaded on demand: the profiler's code is
 * fetched only when the gate opens, so bundlers keep it out of the main
 * bundle. Returns a promise; the sync gate in `webmcp-profiler/attach`
 * is the one to use when tools may register before the promise settles.
 */

import { resolveGate, type GateOptions } from "./gate"
import type { GateConfig, Profiler } from "./index"

export type { GateConfig }

/** Like maybeAttachProfiler, but loads the core only when the gate opens. */
export async function maybeAttachProfilerLazy(config: GateConfig = {}): Promise<Profiler | null> {
  const { mode, rejected } = resolveGate(config as GateOptions)
  if (rejected !== null) warnRejected(config.param ?? "perf", rejected)
  if (!mode) return null
  const { attachProfiler, announce } = await import("./index")
  const profiler = attachProfiler({ ...config, overlay: mode === "overlay" || config.overlay === true })
  announce(profiler, config)
  return profiler
}

/** One warning for an unrecognized gate value. */
export function warnRejected(param: string, value: string): void {
  console.warn(`[webmcp-perf] ?${param}=${value} ignored; accepted: 1, on, true, overlay, 0, off, false`)
}
