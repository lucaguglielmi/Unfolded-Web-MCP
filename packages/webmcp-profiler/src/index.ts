/**
 * webmcp-profiler — a drop-in performance analyser for WebMCP tools.
 *
 * Spec: docs/webmcp-profiler-spec.md. This module is deliberately free of
 * app and framework imports: everything under src/profiler/ lifts out of
 * this repo unchanged (roadmap step 4 — the standalone package).
 *
 *   import { attachProfiler } from "…/profiler"
 *   const profiler = attachProfiler()          // before tools register
 *   __webmcpPerf.table()                        // …later, in DevTools
 *
 * The attach wraps whatever modelContext registry appears (however late),
 * so every registered tool's execute() is measured: wall time, Long-Task
 * blocking, payload bytes and estimated tokens, error rate, and the
 * host+model gaps between calls. Spans mirror onto a BroadcastChannel so
 * a visible same-origin tab can watch a hidden agent tab live.
 */

import { Collector, type Span, type ToolAggregate } from "./collector"
import { startInterception, instrumentMap, type ToolLike } from "./interceptor"
import type { Overlay } from "./overlay"

export interface ProfilerConfig {
  /** ring-buffer size (spans kept in memory) */
  buffer?: number
  /** mirror spans onto BroadcastChannel "webmcp-perf:<origin>" */
  relay?: boolean
  /** open the overlay panel immediately */
  overlay?: boolean
}

export interface Profiler {
  spans: () => readonly Span[]
  aggregates: () => ToolAggregate[]
  /** console.table of per-tool aggregates */
  table: () => void
  /** the versioned JSON report document */
  report: () => Record<string, unknown>
  /** download the report as a .json file */
  export: () => void
  /** toggle the floating panel (lazy-loaded on first use) */
  overlay: () => void
  /** retrofit a site-exposed {name: tool} registry (late-load path) */
  instrument: (tools: Record<string, ToolLike>) => number
  reset: () => void
  /** restore every wrapped execute and stop observing */
  detach: () => void
}

declare global {
  interface Window {
    __webmcpPerf?: Profiler
  }
}

export function attachProfiler(config: ProfilerConfig = {}): Profiler {
  const collector = new Collector(config.buffer ?? 500)
  const interception = startInterception(collector)

  let channel: BroadcastChannel | null = null
  if (config.relay !== false) {
    try {
      channel = new BroadcastChannel(`webmcp-perf:${location.origin}`)
      collector.onSpan((span) => channel?.postMessage({ kind: "span", span }))
    } catch {
      /* environments without BroadcastChannel just skip the relay */
    }
  }

  let overlayInstance: Overlay | null = null
  let overlayLoading: Promise<void> | null = null
  let detached = false
  const toggleOverlay = (): void => {
    if (overlayInstance) {
      overlayInstance.toggle()
      return
    }
    // the panel is a lazy chunk: a second call while it is still loading
    // must not build a second panel, and a detach in the meantime wins
    if (overlayLoading) return
    overlayLoading = import("./overlay").then(({ createOverlay }) => {
      const instance = createOverlay(collector)
      if (detached) instance.destroy()
      else overlayInstance = instance
    })
  }

  const profiler: Profiler = {
    spans: () => collector.spans(),
    aggregates: () => collector.aggregates(),
    table: () => console.table(collector.aggregates()),
    report: () => collector.report(),
    export: () => {
      const blob = new Blob([JSON.stringify(collector.report(), null, 2)], {
        type: "application/json",
      })
      const link = document.createElement("a")
      link.href = URL.createObjectURL(blob)
      link.download = `webmcp-perf-${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}.json`
      link.click()
      URL.revokeObjectURL(link.href)
    },
    overlay: toggleOverlay,
    instrument: (tools) => instrumentMap(tools, collector, interception.originals),
    reset: () => collector.reset(),
    detach: () => {
      detached = true
      interception.stop()
      interception.unwrapAll()
      interception.unpatchAll()
      collector.dispose()
      channel?.close()
      overlayInstance?.destroy()
      if (window.__webmcpPerf === profiler) delete window.__webmcpPerf
    },
  }

  window.__webmcpPerf = profiler
  if (config.overlay) toggleOverlay()
  return profiler
}
