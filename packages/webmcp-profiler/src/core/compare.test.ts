import { describe, expect, it } from "vitest"
import { Collector, type RawSpan } from "./collector"
import { compare, formatDiff } from "./compare"
import { toTraceDocument, toTraceEvents } from "./trace"

const raw = (over: Partial<RawSpan> = {}): RawSpan => ({
  tool: "demo", invokedAt: 100, settledAt: 105, wallMs: 5, blockingMs: 0, inputBytes: 10, resultBytes: 400,
  contentTypes: { text: 1 }, imageBytes: 0, estInputTokens: 3, estTextTokens: 100, estImageTokens: 0, estTokens: 103,
  isError: false, error: null, serializable: true, ...over,
})
const report = (spans: Partial<RawSpan>[], schema = 100) => {
  const c = new Collector()
  c.toolRegistered("demo", schema)
  let t = 0
  for (const s of spans) {
    c.record(raw({ invokedAt: t, settledAt: t + (s.wallMs ?? 5), ...s }))
    t += 1000
  }
  return c.report()
}

describe("compare", () => {
  it("reports per-tool deltas, added and removed tools, and a verdict under thresholds", () => {
    const base = report([{ wallMs: 5 }, { wallMs: 6 }])
    const head = report([{ wallMs: 10, resultBytes: 800 }, { wallMs: 12, resultBytes: 800 }, { tool: "new_tool" }], 120)
    const diff = compare(base, head, { p95Ms: 3, relative: 0.5 })
    const demo = diff.tools.find((t) => t.tool === "demo")!
    expect(demo.status).toBe("changed")
    expect(demo.delta.p95Ms).toBe(6)
    expect(demo.delta.schemaBytes).toBe(20)
    expect(demo.violations.some((v) => v.startsWith("p95Ms grew by 6"))).toBe(true)
    expect(demo.violations.some((v) => v.includes("%"))).toBe(true)
    expect(diff.tools.find((t) => t.tool === "new_tool")!.status).toBe("added")
    expect(diff.verdict).toBe("fail")
    expect(compare(base, base).verdict).toBeNull()
    expect(compare(base, base, { p95Ms: 1 }).verdict).toBe("pass")
    expect(formatDiff(diff)).toContain("verdict: fail")
    expect(formatDiff(diff)).toContain("new_tool")
  })
})

describe("trace", () => {
  it("emits one complete event per span and an instant event per host gap", () => {
    const r = report([{ wallMs: 5 }, { wallMs: 7, isError: true }])
    const events = toTraceEvents(r)
    expect(events.filter((e) => e.ph === "X")).toHaveLength(2)
    expect(events.filter((e) => e.ph === "i")).toHaveLength(1)
    expect(events.find((e) => e.ph === "X" && e.cat.includes("error"))).toBeDefined()
    expect(events[0].ts).toBe(0)
    expect(toTraceDocument(r).metadata).toMatchObject({ source: "webmcp-profiler" })
  })
})
