/**
 * Diff two reports (base and head) per tool, optionally judged against
 * thresholds, for CI budgets and dashboards. Pure: runs anywhere JSON does.
 */
import type { PerfReport, ToolAggregate } from "./collector"

/** Maximum allowed growth per tool; absolute keys are units, relative keys are ratios (0.25 = +25%). */
export interface CompareThresholds {
  p50Ms?: number
  p95Ms?: number
  lastResultBytes?: number
  totalBytes?: number
  estTokens?: number
  schemaBytes?: number
  errorRate?: number
  /** relative growth allowed on p50Ms, p95Ms, lastResultBytes, estTokens, schemaBytes */
  relative?: number
}

/** Per-tool change between base and head. */
export interface ToolDelta {
  tool: string
  status: "changed" | "added" | "removed" | "unchanged"
  base: ToolAggregate | null
  head: ToolAggregate | null
  delta: Partial<Record<"p50Ms" | "p95Ms" | "lastResultBytes" | "totalBytes" | "estTokens" | "schemaBytes" | "errorRate", number>>
  /** which thresholds this tool exceeded, when thresholds were given */
  violations: string[]
}

/** The result of compare(). */
export interface ReportDiff {
  base: { format: string; session: string; calls: number }
  head: { format: string; session: string; calls: number }
  tools: ToolDelta[]
  /** present only when thresholds were given */
  verdict: "pass" | "fail" | null
}

const KEYS = ["p50Ms", "p95Ms", "lastResultBytes", "totalBytes", "estTokens", "schemaBytes"] as const
const RELATIVE_KEYS = ["p50Ms", "p95Ms", "lastResultBytes", "estTokens", "schemaBytes"] as const
const errorRate = (a: ToolAggregate): number => (a.calls ? a.errors / a.calls : 0)

/** Compare head against base; with thresholds, also judge each tool. */
export function compare(base: PerfReport, head: PerfReport, thresholds?: CompareThresholds): ReportDiff {
  const baseBy = new Map(base.tools.map((t) => [t.tool, t]))
  const headBy = new Map(head.tools.map((t) => [t.tool, t]))
  const names = [...new Set([...baseBy.keys(), ...headBy.keys()])].sort()
  const tools: ToolDelta[] = names.map((tool) => {
    const b = baseBy.get(tool) ?? null
    const h = headBy.get(tool) ?? null
    const delta: ToolDelta["delta"] = {}
    const violations: string[] = []
    if (b && h) {
      for (const key of KEYS) delta[key] = h[key] - b[key]
      delta.errorRate = errorRate(h) - errorRate(b)
      if (thresholds) {
        for (const key of KEYS) {
          const limit = thresholds[key]
          if (limit !== undefined && (delta[key] ?? 0) > limit) violations.push(`${key} grew by ${delta[key]} (limit ${limit})`)
        }
        if (thresholds.errorRate !== undefined && (delta.errorRate ?? 0) > thresholds.errorRate)
          violations.push(`errorRate grew by ${delta.errorRate?.toFixed(3)} (limit ${thresholds.errorRate})`)
        if (thresholds.relative !== undefined) {
          for (const key of RELATIVE_KEYS) {
            if (b[key] > 0 && h[key] / b[key] - 1 > thresholds.relative)
              violations.push(`${key} grew ${((h[key] / b[key] - 1) * 100).toFixed(0)}% (limit ${thresholds.relative * 100}%)`)
          }
        }
      }
    }
    const changed = Object.values(delta).some((v) => v !== 0)
    const status: ToolDelta["status"] = !b ? "added" : !h ? "removed" : changed ? "changed" : "unchanged"
    return { tool, status, base: b, head: h, delta, violations }
  })
  return {
    base: { format: base.format, session: base.session.id, calls: base.ledger.totals.calls },
    head: { format: head.format, session: head.session.id, calls: head.ledger.totals.calls },
    tools,
    verdict: thresholds ? (tools.some((t) => t.violations.length > 0) ? "fail" : "pass") : null,
  }
}

/** A terminal-friendly rendering of a diff. */
export function formatDiff(diff: ReportDiff): string {
  const lines = [`base ${diff.base.session} (${diff.base.calls} calls) → head ${diff.head.session} (${diff.head.calls} calls)`]
  for (const t of diff.tools) {
    if (t.status === "unchanged") continue
    const parts = Object.entries(t.delta)
      .filter(([, v]) => v !== 0)
      .map(([k, v]) => `${k} ${v! > 0 ? "+" : ""}${Number.isInteger(v) ? v : v!.toFixed(2)}`)
    lines.push(`  ${t.tool.padEnd(22)} ${t.status.padEnd(9)} ${parts.join(" · ")}`)
    for (const v of t.violations) lines.push(`    ✗ ${v}`)
  }
  if (diff.verdict) lines.push(`verdict: ${diff.verdict}`)
  return lines.join("\n")
}
