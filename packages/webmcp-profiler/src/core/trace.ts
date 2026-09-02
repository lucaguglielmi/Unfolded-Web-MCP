/**
 * Chrome trace-event JSON, so a session opens in Perfetto or
 * chrome://tracing next to whatever else the reader traces.
 */
import type { PerfReport } from "./collector"

/** One trace event in the Chrome trace-event format. */
export interface TraceEvent {
  name: string
  cat: string
  ph: "X" | "i"
  ts: number
  dur?: number
  pid: number
  tid: number
  s?: "t"
  args: Record<string, unknown>
}

/** Spans as complete events, host gaps as instant events between them. */
export function toTraceEvents(report: PerfReport): TraceEvent[] {
  const events: TraceEvent[] = []
  const spans = [...report.spans].sort((a, b) => a.invokedAt - b.invokedAt)
  for (const span of spans) {
    if (span.gapSincePrevCallMs !== null && span.gapSincePrevCallMs > 0) {
      events.push({
        name: `host gap ${Math.round(span.gapSincePrevCallMs)}ms`,
        cat: "webmcp.gap",
        ph: "i",
        ts: (span.invokedAt - span.gapSincePrevCallMs) * 1000,
        pid: 1,
        tid: 1,
        s: "t",
        args: { gapMs: span.gapSincePrevCallMs, before: span.tool },
      })
    }
    events.push({
      name: span.tool,
      cat: span.isError ? "webmcp,error" : "webmcp",
      ph: "X",
      ts: span.invokedAt * 1000,
      dur: span.wallMs * 1000,
      pid: 1,
      tid: 1,
      args: {
        seq: span.seq,
        inputBytes: span.inputBytes,
        resultBytes: span.resultBytes,
        estTokens: span.estTokens,
        blockingMs: span.blockingMs,
        contentTypes: span.contentTypes,
        error: span.error,
        synthetic: span.synthetic,
      },
    })
  }
  return events
}

/** The full trace document Perfetto expects. */
export function toTraceDocument(report: PerfReport): { traceEvents: TraceEvent[]; metadata: Record<string, unknown> } {
  return {
    traceEvents: toTraceEvents(report),
    metadata: { source: "webmcp-profiler", format: report.format, session: report.session },
  }
}
