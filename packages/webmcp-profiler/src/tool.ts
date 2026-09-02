/**
 * A WebMCP tool that returns the profiler's report, so an agent driving
 * the site through its host can read the numbers without a console.
 *
 *   import { profilerTool } from "webmcp-profiler/tool"
 *   document.modelContext.registerTool(profilerTool(profiler))
 *
 * The tool is listed in the ledger but never measured.
 */

import { REPORT_VIEWS, type ReportView } from "./core/text"
import { PROFILER_INTERNAL, type ToolLike } from "./core/interceptor"
import { reportToolNames } from "./core/internal"
import { utf8Length, type LedgerTotals, type Span, type ToolAggregate } from "./core/collector"
import type { Profiler, ProfilerStatus } from "./index"

/** Options for profilerTool. */
export interface ProfilerToolOptions {
  /** the tool's registered name */
  name?: string
  title?: string
}

/** The input the tool accepts. */
export interface ProfilerToolInput {
  view?: ReportView
  tool?: string
  limit?: number
  since?: number
}

/** The structured half of the tool's result. */
export interface ProfilerToolResult {
  ok: true
  format: string
  session: { id: string; version: string }
  status: ProfilerStatus
  totals: LedgerTotals
  split: string
  tools?: ToolAggregate[]
  spans?: Span[]
  truncated?: boolean
  meta: { view: ReportView; resultBytes: number; estTokens: number }
}

/** The descriptor profilerTool returns. */
export type ProfilerToolDescriptor = ToolLike & {
  title: string
  description: string
  inputSchema: Record<string, unknown>
  annotations: Record<string, unknown>
}

/** A descriptor a site registers beside its own tools; the profiler lists it and skips measuring it. */
export function profilerTool(profiler: Profiler, options: ProfilerToolOptions = {}): ProfilerToolDescriptor {
  const name = options.name ?? "get_perf_report"
  reportToolNames.set(profiler, name)
  const views = Object.entries(REPORT_VIEWS)
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ")
  const descriptor: ProfilerToolDescriptor = {
    name,
    title: options.title ?? "Performance report for this site's tools",
    description:
      "Read the built-in profiler's measurements of this site's WebMCP tools: execute() time per tool, " +
      "payload bytes and estimated tokens, and the host + model gaps between calls. Views: " +
      views +
      ". Start with summary; ask for spans only when you need individual calls.",
    inputSchema: {
      type: "object",
      properties: {
        view: { type: "string", enum: Object.keys(REPORT_VIEWS), default: "summary", description: "how much to return" },
        tool: { type: "string", description: "restrict to one tool name" },
        limit: { type: "integer", minimum: 1, maximum: 500, default: 50, description: "newest spans to include (view=spans)" },
        since: { type: "integer", minimum: 0, description: "only spans with seq greater than this (view=spans)" },
      },
      additionalProperties: false,
    },
    annotations: { title: options.title ?? "Performance report", readOnlyHint: true },
    async execute(input: unknown) {
      const args = (input && typeof input === "object" ? input : {}) as ProfilerToolInput
      const view: ReportView = args.view && args.view in REPORT_VIEWS ? args.view : "summary"
      const ledger = profiler.ledger()
      const head = profiler.report({ spans: false })
      const summaryText = profiler.summary()
      const structured: ProfilerToolResult = {
        ok: true,
        format: head.format,
        session: { id: ledger.sessionId, version: head.session.version },
        status: profiler.status(),
        totals: ledger.totals,
        split: summaryText.split("\n")[1] ?? "",
        meta: { view, resultBytes: 0, estTokens: 0 },
      }
      if (view === "tools" || view === "spans") {
        structured.tools = profiler.aggregates().filter((a) => !args.tool || a.tool === args.tool)
      }
      if (view === "spans") {
        const limit = Math.min(500, Math.max(1, Math.floor(args.limit ?? 50)))
        const spans = profiler
          .spans()
          .filter((s) => (!args.tool || s.tool === args.tool) && (args.since === undefined || s.seq > args.since))
        structured.truncated = spans.length > limit
        structured.spans = spans.slice(-limit).reverse()
      }
      const text = view === "summary" ? summaryText : `${summaryText}\n(structuredContent carries the ${view} view)`
      const bytes = utf8Length(JSON.stringify({ content: [{ type: "text", text }], structuredContent: structured }))
      structured.meta.resultBytes = bytes
      structured.meta.estTokens = Math.ceil(bytes / 4)
      return { content: [{ type: "text", text }], structuredContent: structured, isError: false }
    },
  }
  Object.defineProperty(descriptor, PROFILER_INTERNAL, { value: true, enumerable: false })
  return descriptor
}
