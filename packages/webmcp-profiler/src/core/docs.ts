/**
 * The one typed source of truth for everything that describes the
 * profiler: span and ledger fields, console methods, configuration keys,
 * report views, and the status phases with their hints. `help()`,
 * `describe()`, the README's generated blocks, `llms.txt`, and a
 * consuming site's agent manifest are all projections of these tables.
 * Adding a key to a type without a line here is a compile error.
 */

import { PACKAGE_VERSION, REPORT_FORMAT, type Ledger, type LedgerTotals, type Span } from "./collector"
import { REPORT_VIEWS, type ReportView } from "./text"
import type { PerfMode } from "../gate"
import { DEFAULTS } from "./defaults"
import type { GateConfig, Profiler, ProfilerConfig } from "../index"

export { PHASE_HINTS, REPORT_VIEWS, type ReportView } from "./text"

/** One line per Span field. */
export const SPAN_FIELDS: Record<keyof Span, string> = {
  sessionId: "the profiler session that recorded the span; `${sessionId}#${seq}` is its identity",
  seq: "sequence number within the session, from 0",
  tool: "the tool's registered name",
  invokedAt: "performance.now() when execute() was called",
  settledAt: "performance.now() when execute() resolved or threw",
  wallMs: "the execute() await, end to end",
  blockingMs: "Long-Task overlap attributed to this call (fills in after the task ends; Chromium only)",
  inputBytes: "UTF-8 bytes of the input's JSON",
  resultBytes: "UTF-8 bytes of the result's JSON",
  contentTypes: "count per content type, e.g. { text: 1, image: 1 }",
  imageBytes: "base64 length of image content in the result",
  estInputTokens: "estimated tokens the model wrote to produce the input",
  estTextTokens: "estimated tokens to read the non-image part of the result",
  estImageTokens: "estimated tokens to read the image part of the result",
  estTokens: "estInputTokens + estTextTokens + estImageTokens: what this call costs the model",
  isError: "the tool reported isError, or threw",
  error: "the error message (capped at 200 chars), name, or null, per errorPolicy",
  gapSincePrevCallMs: "idle from the previous result settling to this call arriving: host + model think time; null when the calls overlapped",
  synthetic: "recorded by the bench rather than a live host",
  serializable: "false when the result could not be JSON-serialized (bytes then read 0)",
}

/** One line per Ledger field, with totals under `totals.`. */
export const LEDGER_FIELDS: Record<Exclude<keyof Ledger, "totals"> | `totals.${keyof LedgerTotals}`, string> = {
  sessionId: "this profiler session's id",
  attachedAt: "epoch ms when the profiler attached",
  hostFoundAt: "performance.now() when a modelContext registry was first seen",
  hostLocation: "where it was found: document (the draft), navigator or window (legacy hosts)",
  firstRegistrationAt: "performance.now() of the first registerTool / provideContext",
  registeredTools: "names currently registered",
  tools: "per tool: schemaBytes, registeredAt, unregisteredAt, internal",
  firstCallAt: "performance.now() of the first measured call",
  lastSettledAt: "performance.now() of the latest settle",
  "totals.calls": "every call seen, measured or not",
  "totals.unsampledCalls": "calls that ran unmeasured because `sample` excluded them",
  "totals.overlappingCalls": "calls invoked before the previous call settled",
  "totals.errors": "calls that reported or threw an error",
  "totals.wallMs": "summed execute() time",
  "totals.blockingMs": "summed Long-Task overlap, union across overlapping calls",
  "totals.resultBytes": "summed result bytes",
  "totals.estTokens": "summed estimated tokens (input + result)",
  "totals.estInputTokens": "summed estimated input tokens",
  "totals.hostGapMs": "summed settled-to-next-invoke gaps: host + model wait, by definition",
  "totals.schemaBytes": "descriptor bytes of the tools currently registered, paid in every conversation",
  "totals.estSchemaTokens": "the same as tokens",
}

/** One line per public member of a Profiler. */
export const METHOD_DOCS: Record<keyof Profiler, string> = {
  active: "true unless this is the server-side no-op or detach() has run",
  sessionId: "this session's 8-hex id, stamped on every span",
  spans: "the raw span ring buffer, oldest first",
  aggregates: "per-tool rows: calls, errors, min/p50/p95/max, blocking, bytes, tokens, schema bytes",
  ledger: "the session ledger: host timeline, registered tools, running totals",
  onSpan: "subscribe to spans as they settle; returns an unsubscribe function",
  onSpanUpdate: "subscribe to late corrections (Long-Task blocking); returns unsubscribe",
  status: "what the profiler is doing right now: phase, one sentence, and next steps",
  help: "print the status line and this method list to the console",
  summary: "a few lines of text: the split, then one line per tool",
  describe: "the machine-readable manifest of this profiler's API, fields, and configuration",
  table: "console.table of the per-tool rows, rounded for reading",
  report: "the versioned JSON document; report({ spans: false }) omits spans, { spans: 50 } keeps the newest 50, { tool } filters",
  export: "download report() as a .json file",
  exportTrace: "download the spans as Chrome trace-event JSON for Perfetto or chrome://tracing",
  overlay: "toggle the floating panel (loaded on first use)",
  instrument: "retrofit a site-exposed { name: tool } registry wrapped after load; returns how many",
  synthetic: "mark spans recorded from now on as synthetic (the bench uses it)",
  reset: "clear spans and totals; keeps the tool registry",
  detach: "restore every original execute and registry method, stop observing, drop the global",
}

/** One entry per configuration key of attachProfiler and the gate. */
export const CONFIG_DOCS: Record<keyof ProfilerConfig | keyof GateConfig, { doc: string; default: string }> = {
  buffer: { doc: "spans kept in memory (ring buffer)", default: "500" },
  relay: { doc: "mirror spans onto a BroadcastChannel so a visible same-origin tab can watch", default: "true" },
  overlay: { doc: "open the floating panel immediately", default: "false" },
  globalName: { doc: "window property to expose the API on; false exposes nothing", default: '"__webmcpPerf"' },
  channel: { doc: "BroadcastChannel name for the relay", default: '"webmcp-perf:" + location.origin' },
  pollMs: { doc: "registry sweep interval while no host has been found", default: "250" },
  tokenEstimator: { doc: "replaces the bytes-to-tokens heuristic for every content kind", default: "bytes/4; images at decoded size" },
  onSpan: { doc: "a listener subscribed at attach time", default: "none" },
  sample: { doc: "fraction of calls that get a span (0..1); the rest pass through unmeasured", default: "1" },
  errorPolicy: { doc: 'what an error span keeps: "message" (capped at 200), "name", or "none"', default: '"message"' },
  param: { doc: "query parameter that arms the profiler", default: '"perf"' },
  storageKey: { doc: "localStorage key that persists the mode across URL rewrites", default: '"webmcp-perf:mode"' },
  announce: { doc: "console line on attach; false silences, a function replaces it", default: "true" },
  allow: { doc: "the site's last word on whether the gate may open; false also clears a persisted mode", default: "() => true" },
}

/** Accepted values of the gate's query parameter and what they do. */
export const GATE_MODES: Record<PerfMode | "0", string> = {
  "1": "turn profiling on and remember it for this origin (also: on, true)",
  overlay: "on, with the floating panel open",
  "0": "turn it off and forget it (also: off, false)",
}

/** The privacy statement, one line per fact. */
export const PRIVACY: string[] = [
  "spans carry sizes, shapes, timings, tool names, and (per errorPolicy) error messages; never input or result bodies",
  "nothing leaves the browser: the relay is a same-origin BroadcastChannel and export() is a download",
  "any same-origin script or tab can read the global and the relay; use globalName: false and relay: false for production telemetry through onSpan",
  "the gate's allow predicate is the site's last word on who can arm profiling",
]

/** The machine-readable description of a profiler's API, fields, and configuration. */
export interface ProfilerManifest {
  package: { name: "webmcp-profiler"; version: string; format: typeof REPORT_FORMAT }
  activation: {
    param: string
    storageKey: string
    modes: Record<PerfMode | "0", string>
    cost: string
  }
  console: { global: string | false; methods: Record<keyof Profiler, string> }
  span: Record<keyof Span, string>
  ledger: Record<string, string>
  config: Record<string, { doc: string; default: string }>
  tool: { name: string; views: Record<ReportView, string> } | null
  relay: { channel: string | false; scope: string }
  privacy: string[]
}

/** Build the manifest for a configuration (defaults applied). */
export function describe(
  config: Partial<ProfilerConfig & GateConfig> = {},
  toolName: string | null = null
): ProfilerManifest {
  const origin = typeof location === "undefined" ? "<origin>" : location.origin
  const relay = config.relay ?? DEFAULTS.relay
  return {
    package: { name: "webmcp-profiler", version: PACKAGE_VERSION, format: REPORT_FORMAT },
    activation: {
      param: config.param ?? DEFAULTS.param,
      storageKey: config.storageKey ?? DEFAULTS.storageKey,
      modes: GATE_MODES,
      cost: "zero when off; when on, two clock reads, one JSON serialization of input and result, and a ring-buffer push per call",
    },
    console: { global: config.globalName ?? DEFAULTS.globalName, methods: METHOD_DOCS },
    span: SPAN_FIELDS,
    ledger: LEDGER_FIELDS,
    config: CONFIG_DOCS,
    tool: toolName ? { name: toolName, views: REPORT_VIEWS } : null,
    relay: { channel: relay ? config.channel ?? `webmcp-perf:${origin}` : false, scope: "same-origin tabs and frames on this device" },
    privacy: PRIVACY,
  }
}
