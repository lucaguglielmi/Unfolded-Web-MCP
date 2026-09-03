/**
 * webmcp-profiler: a drop-in performance analyser for WebMCP tool surfaces.
 *
 *   import { attachProfiler } from "webmcp-profiler"
 *   const profiler = attachProfiler()   // before tools register
 *   __webmcpPerf.summary()              // later, from DevTools
 *
 * attachProfiler wraps whatever modelContext registry appears, however
 * late, so every registered tool's execute() is measured: wall time,
 * Long-Task blocking, payload bytes and estimated tokens, error rate,
 * and the host + model gaps between calls. Spans mirror onto a
 * BroadcastChannel so a visible same-origin tab can watch a hidden one.
 */

import {
  Collector,
  type ErrorPolicy,
  type Ledger,
  type PerfReport,
  type ReportOptions,
  type Span,
  type SpanUpdate,
  type TokenEstimator,
  type ToolAggregate,
} from "./core/collector"
import { PHASE_HINTS } from "./core/text"
import type { ProfilerManifest } from "./core/docs"
import { fmtMs, fmtSplit, fmtToolLine } from "./core/format"
import { instrumentMap, startInterception, type Interception, type ToolLike, type WrapOptions } from "./core/interceptor"
import { reportToolNames } from "./core/internal"
import { toTraceDocument } from "./core/trace"
import { DEFAULTS } from "./core/defaults"
import type { GateOptions } from "./gate"
import type { Overlay } from "./overlay"

export { DEFAULTS } from "./core/defaults"

export type {
  ContentKind,
  ErrorPolicy,
  Ledger,
  LedgerTotals,
  PerfReport,
  ReportOptions,
  Span,
  SpanUpdate,
  TokenEstimator,
  TokenPart,
  ToolAggregate,
  ToolRecord,
} from "./core/collector"
export { PACKAGE_VERSION, REPORT_FORMAT, aggregateSpans, defaultTokenEstimator, quantile, totalsFromSpans, utf8Length } from "./core/collector"
export type { ToolLike } from "./core/interceptor"
export { PROFILER_INTERNAL, isToolLike } from "./core/interceptor"
export type { ProfilerManifest, ReportView } from "./core/docs"
export { PHASE_HINTS, REPORT_VIEWS } from "./core/text"
export { compare, formatDiff, type CompareThresholds, type ReportDiff, type ToolDelta } from "./core/compare"
export { toTraceDocument, toTraceEvents, type TraceEvent } from "./core/trace"
export type { PerfMode } from "./gate"

/** Configuration for attachProfiler; every default is the 0.1 behaviour. */
export interface ProfilerConfig {
  /** spans kept in memory (ring buffer) */
  buffer?: number
  /** mirror spans onto a BroadcastChannel so a visible same-origin tab can watch */
  relay?: boolean
  /** open the floating panel immediately */
  overlay?: boolean
  /** window property to expose the API on; false exposes nothing */
  globalName?: string | false
  /** BroadcastChannel name; default `webmcp-perf:${location.origin}` */
  channel?: string
  /** registry sweep interval (ms) while no host has been found */
  pollMs?: number
  /** replaces the bytes-to-tokens heuristic for every content kind */
  tokenEstimator?: TokenEstimator
  /** a listener subscribed at attach time */
  onSpan?: (span: Span) => void
  /** fraction of calls that get a span, 0..1; the rest pass through unmeasured */
  sample?: number
  /** what an error span keeps of a thrown error */
  errorPolicy?: ErrorPolicy
}

/** Configuration for the boot gate: the profiler's plus the gate's own keys. */
export interface GateConfig extends ProfilerConfig, GateOptions {
  /** console line on attach; false silences, a function replaces it */
  announce?: boolean | ((profiler: Profiler) => void)
}

/** What the profiler is doing. */
export type ProfilerPhase = "inactive" | "no-host" | "host-found" | "tools-registered" | "measuring" | "detached"

/** The profiler's state in one object, with a sentence and next steps. */
export interface ProfilerStatus {
  phase: ProfilerPhase
  /** one sentence a person can act on */
  message: string
  hostLocation: string | null
  hostFoundAt: number | null
  toolCount: number
  callCount: number
  lastCallAt: number | null
  /** concrete next steps for the current phase, in order */
  hints: string[]
}

/** The console and programmatic API of an attached profiler. */
export interface Profiler {
  /** true unless this is the server-side no-op or detach() has run */
  readonly active: boolean
  /** this session's id, stamped on every span */
  readonly sessionId: string
  /** the raw span ring buffer, oldest first */
  spans(): readonly Span[]
  /** per-tool statistics over the buffered spans */
  aggregates(): ToolAggregate[]
  /** the session ledger: host timeline, registered tools, running totals */
  ledger(): Readonly<Ledger>
  /** subscribe to spans as they settle; returns unsubscribe */
  onSpan(listener: (span: Span) => void): () => void
  /** subscribe to late corrections (Long-Task blocking); returns unsubscribe */
  onSpanUpdate(listener: (update: SpanUpdate) => void): () => void
  /** what the profiler is doing right now */
  status(): ProfilerStatus
  /** print the status line and the method list to the console (loads the docs on first use) */
  help(): Promise<void>
  /** a few lines of text: the split, then one line per tool */
  summary(): string
  /** the machine-readable manifest of this profiler's API, fields, and configuration (loads the docs on first use) */
  describe(): Promise<ProfilerManifest>
  /** console.table of the per-tool rows, rounded for reading */
  table(): void
  /** the versioned JSON document */
  report(options?: ReportOptions): PerfReport
  /** download report() as a .json file */
  export(): void
  /** download the spans as Chrome trace-event JSON */
  exportTrace(): void
  /** toggle the floating panel (loaded on first use) */
  overlay(): void
  /** retrofit a site-exposed { name: tool } registry; returns how many were wrapped */
  instrument(tools: Record<string, ToolLike>): number
  /** mark spans recorded from now on as synthetic (the bench uses it) */
  synthetic(flag: boolean): void
  /** clear spans and totals; keeps the tool registry */
  reset(): void
  /** restore every original execute and registry method, stop observing, drop the global */
  detach(): void
}

declare global {
  interface Window {
    __webmcpPerf?: Profiler
  }
}

let current: Profiler | null = null

const download = (name: string, body: string, type: string): void => {
  const blob = new Blob([body], { type })
  const link = document.createElement("a")
  link.href = URL.createObjectURL(blob)
  link.download = name
  link.click()
  URL.revokeObjectURL(link.href)
}

const stamp = (): string => new Date().toISOString().slice(0, 19).replaceAll(":", "-")

const noopReport = (): PerfReport => new Collector({ sessionId: "00000000" }).report()

/** The profiler handed out where there is no window (server-side rendering). */
function createNoopProfiler(): Profiler {
  const profiler: Profiler = {
    active: false,
    sessionId: "00000000",
    spans: () => [],
    aggregates: () => [],
    ledger: () => noopReport().ledger,
    onSpan: () => () => undefined,
    onSpanUpdate: () => () => undefined,
    status: () => ({
      phase: "inactive",
      message: PHASE_HINTS.inactive.message,
      hostLocation: null,
      hostFoundAt: null,
      toolCount: 0,
      callCount: 0,
      lastCallAt: null,
      hints: PHASE_HINTS.inactive.hints,
    }),
    help: async () => undefined,
    summary: () => PHASE_HINTS.inactive.message,
    describe: () => import("./core/docs").then(({ describe }) => describe({})),
    table: () => undefined,
    report: noopReport,
    export: () => undefined,
    exportTrace: () => undefined,
    overlay: () => undefined,
    instrument: () => 0,
    synthetic: () => undefined,
    reset: () => undefined,
    detach: () => undefined,
  }
  return Object.freeze(profiler)
}

/** Attach the profiler; idempotent (a second call returns the active instance) and a no-op without a window. */
export function attachProfiler(config: ProfilerConfig = {}): Profiler {
  if (typeof window === "undefined" || typeof document === "undefined") return createNoopProfiler()
  if (current?.active) {
    console.warn("[webmcp-perf] already attached; call detach() first to attach with a new configuration")
    return current
  }

  const collector = new Collector({ bufferSize: config.buffer ?? DEFAULTS.buffer, tokenEstimator: config.tokenEstimator })
  const wrap: WrapOptions = {
    collector,
    originals: new Map(),
    sample: Math.min(1, Math.max(0, config.sample ?? DEFAULTS.sample)),
    errorPolicy: config.errorPolicy ?? DEFAULTS.errorPolicy,
  }
  const interception: Interception = startInterception(wrap, { pollMs: config.pollMs ?? DEFAULTS.pollMs })
  const globalName = config.globalName ?? DEFAULTS.globalName
  const channelName = config.relay === false ? false : config.channel ?? `webmcp-perf:${location.origin}`

  let channel: BroadcastChannel | null = null
  if (channelName !== false) {
    try {
      channel = new BroadcastChannel(channelName)
      collector.onSpan((span) => channel?.postMessage({ kind: "span", span }))
      collector.onUpdate((update) => channel?.postMessage({ kind: "update", ...update }))
    } catch {
      /* environments without BroadcastChannel just skip the relay */
    }
  }
  if (config.onSpan) collector.onSpan(config.onSpan)

  let overlayInstance: Overlay | null = null
  let overlayLoading: Promise<void> | null = null
  let active = true

  const status = (): ProfilerStatus => {
    const l = collector.ledger
    const phase: ProfilerPhase = !active
      ? "detached"
      : l.totals.calls > 0
        ? "measuring"
        : l.registeredTools.length > 0
          ? "tools-registered"
          : l.hostFoundAt !== null
            ? "host-found"
            : "no-host"
    const base = PHASE_HINTS[phase]
    const detail =
      phase === "host-found"
        ? ` (on ${l.hostLocation} at ${fmtMs(l.hostFoundAt ?? 0)})`
        : phase === "tools-registered"
          ? ` (${l.registeredTools.length} tools on ${l.hostLocation})`
          : phase === "measuring"
            ? `: ${fmtSplit(l.totals)}`
            : ""
    return {
      phase,
      message: base.message + detail,
      hostLocation: l.hostLocation,
      hostFoundAt: l.hostFoundAt,
      toolCount: l.registeredTools.length,
      callCount: l.totals.calls,
      lastCallAt: l.lastSettledAt,
      hints: base.hints,
    }
  }

  const toggleOverlay = (): void => {
    if (overlayInstance) {
      overlayInstance.toggle()
      return
    }
    // the panel is a lazy chunk: a second call while it is still loading
    // must not build a second panel, and a detach in the meantime wins
    if (overlayLoading) return
    overlayLoading = import("./overlay").then(({ createOverlay }) => {
      const instance = createOverlay(collector, { status, channel: channelName })
      if (!active) instance.destroy()
      else overlayInstance = instance
    })
  }

  const profiler: Profiler = {
    get active() {
      return active
    },
    sessionId: collector.ledger.sessionId,
    spans: () => collector.spans(),
    aggregates: () => collector.aggregates(),
    ledger: () => collector.ledger,
    onSpan: (listener) => collector.onSpan(listener),
    onSpanUpdate: (listener) => collector.onUpdate(listener),
    status,
    help: async () => {
      const { METHOD_DOCS } = await import("./core/docs")
      const s = status()
      const lines = [`webmcp-profiler ${s.message}`, ...s.hints.map((h) => `  → ${h}`), ""]
      for (const [name, doc] of Object.entries(METHOD_DOCS)) lines.push(`  ${name.padEnd(14)} ${doc}`)
      lines.push("", "README: https://www.npmjs.com/package/webmcp-profiler")
      console.info(lines.join("\n"))
    },
    summary: () => {
      const l = collector.ledger
      const s = status()
      const lines = [
        `webmcp-profiler · session ${l.sessionId} · ${s.phase} · ${l.registeredTools.length} tools · ${l.totals.calls} calls`,
        fmtSplit(l.totals),
        ...collector.aggregates().map((a) => `  ${fmtToolLine(a)}`),
      ]
      return lines.join("\n")
    },
    describe: () => import("./core/docs").then(({ describe }) => describe({ ...config, globalName }, reportToolNames.get(profiler) ?? null)),
    table: () => {
      const r1 = (n: number) => Math.round(n * 10) / 10
      console.table(
        collector.aggregates().map((a) => ({
          tool: a.tool,
          calls: a.calls,
          errors: a.errors,
          "p50 (ms)": r1(a.p50Ms),
          "p95 (ms)": r1(a.p95Ms),
          "max (ms)": r1(a.maxMs),
          "blocking (ms)": r1(a.blockingMs),
          "last (B)": a.lastResultBytes,
          "total (KB)": r1(a.totalBytes / 1024),
          "est tokens": a.estTokens.toLocaleString(),
          "schema (B)": a.schemaBytes,
        }))
      )
    },
    report: (options) => collector.report(options),
    export: () => download(`webmcp-perf-${stamp()}.json`, JSON.stringify(collector.report(), null, 2), "application/json"),
    exportTrace: () =>
      download(`webmcp-perf-${stamp()}.trace.json`, JSON.stringify(toTraceDocument(collector.report())), "application/json"),
    overlay: toggleOverlay,
    instrument: (tools) => instrumentMap(tools, wrap),
    synthetic: (flag) => {
      collector.synthetic = flag
    },
    reset: () => collector.reset(),
    detach: () => {
      if (!active) return
      active = false
      interception.stop()
      interception.unwrapAll()
      interception.unpatchAll()
      collector.dispose()
      channel?.close()
      overlayInstance?.destroy()
      overlayInstance = null
      if (globalName !== false && (window as unknown as Record<string, unknown>)[globalName] === profiler) {
        delete (window as unknown as Record<string, unknown>)[globalName]
      }
      if (current === profiler) current = null
    },
  }

  current = profiler
  if (globalName !== false) (window as unknown as Record<string, unknown>)[globalName] = profiler
  if (config.overlay ?? DEFAULTS.overlay) toggleOverlay()
  return profiler
}

/** The console line the gate prints on attach (or the consumer's replacement). */
export function announce(profiler: Profiler, config: GateConfig): void {
  const setting = config.announce ?? DEFAULTS.announce
  if (setting === false) return
  if (typeof setting === "function") {
    setting(profiler)
    return
  }
  const globalName = config.globalName ?? DEFAULTS.globalName
  const handle = globalName === false ? "profiler" : globalName
  const param = config.param ?? DEFAULTS.param
  console.info(`[webmcp-perf] profiling on — ${handle}.help() · ?${param}=0 to disable · ${profiler.status().message}`)
}
