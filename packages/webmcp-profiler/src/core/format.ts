/**
 * Number formatting shared by the overlay, the summary, and the console
 * table: milliseconds, bytes, and token counts in the shortest honest form.
 */

/** 4.8ms, 1.2s */
export const fmtMs = (ms: number): string => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms.toFixed(1)}ms`)

/** 812B, 7.1KB, 1.3MB */
export const fmtBytes = (b: number): string =>
  b >= 1_048_576 ? `${(b / 1_048_576).toFixed(1)}MB` : b >= 1024 ? `${(b / 1024).toFixed(1)}KB` : `${Math.round(b)}B`

/** ~200 tok, ~1.8K tok, ~78K tok */
export const fmtTokens = (n: number): string =>
  n >= 1000 ? `~${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K tok` : `~${Math.round(n)} tok`

/** The one-line "where did the time go" split from a totals-like object. */
export const fmtSplit = (t: {
  schemaBytes?: number
  estSchemaTokens?: number
  wallMs: number
  resultBytes: number
  estTokens: number
  hostGapMs: number
}): string =>
  (t.schemaBytes ? `schemas ${fmtBytes(t.schemaBytes)} (${fmtTokens(t.estSchemaTokens ?? 0)}) · ` : "") +
  `tools ${fmtMs(t.wallMs)} · payloads ${fmtBytes(t.resultBytes)} (${fmtTokens(t.estTokens)}) · host gaps ${fmtMs(t.hostGapMs)}`

/** One per-tool line for the summary text. */
export const fmtToolLine = (a: {
  tool: string
  calls: number
  errors: number
  p50Ms: number
  p95Ms: number
  lastResultBytes: number
  estTokens: number
}): string =>
  `${a.tool.padEnd(22)} ${String(a.calls).padStart(3)} calls · p50 ${fmtMs(a.p50Ms)} · p95 ${fmtMs(a.p95Ms)}` +
  ` · last ${fmtBytes(a.lastResultBytes)} (${fmtTokens(a.estTokens)})${a.errors ? ` · ✗${a.errors}` : ""}`
