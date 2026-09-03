import { describe, expect, it, vi } from "vitest"
import {
  Collector,
  REPORT_FORMAT,
  aggregateSpans,
  totalsFromSpans,
  utf8Length,
  type RawSpan,
  type Span,
} from "./core/collector"

const raw = (over: Partial<RawSpan> = {}): RawSpan => ({
  tool: "demo",
  invokedAt: 100,
  settledAt: 105,
  wallMs: 5,
  blockingMs: 0,
  inputBytes: 10,
  resultBytes: 400,
  contentTypes: { text: 1 },
  imageBytes: 0,
  estInputTokens: 3,
  estTextTokens: 100,
  estImageTokens: 0,
  estTokens: 103,
  isError: false,
  error: null,
  serializable: true,
  ...over,
})

describe("Collector", () => {
  it("aggregates per tool with percentiles and totals", () => {
    const c = new Collector()
    for (let i = 1; i <= 10; i++) c.record(raw({ wallMs: i, invokedAt: i * 100, settledAt: i * 100 + i }))
    c.record(raw({ tool: "other", wallMs: 50, isError: true, invokedAt: 2000, settledAt: 2050 }))
    const byTool = Object.fromEntries(c.aggregates().map((a) => [a.tool, a]))
    expect(byTool.demo.calls).toBe(10)
    expect(byTool.demo.minMs).toBe(1)
    expect(byTool.demo.maxMs).toBe(10)
    expect(byTool.demo.p50Ms).toBe(6)
    expect(byTool.other.errors).toBe(1)
    expect(c.ledger.totals.calls).toBe(11)
    expect(c.ledger.totals.errors).toBe(1)
    expect(c.ledger.totals.estTokens).toBe(11 * 103)
    expect(c.ledger.totals.estInputTokens).toBe(33)
  })

  it("computes host gaps from settle to next invoke, null when calls overlap", () => {
    const c = new Collector()
    c.record(raw({ invokedAt: 100, settledAt: 110 }))
    const second = c.record(raw({ invokedAt: 4110, settledAt: 4115 }))
    expect(second.gapSincePrevCallMs).toBe(4000)
    expect(c.ledger.totals.hostGapMs).toBe(4000)
    const overlapping = c.record(raw({ invokedAt: 4112, settledAt: 4120 }))
    expect(overlapping.gapSincePrevCallMs).toBeNull()
    expect(c.ledger.totals.overlappingCalls).toBe(1)
    expect(c.ledger.totals.hostGapMs).toBe(4000)
    expect(c.ledger.lastSettledAt).toBe(4120)
    expect(c.ledger.firstCallAt).toBe(100)
  })

  it("keeps only the newest spans past the buffer size and clears their measures", () => {
    const clear = vi.spyOn(performance, "clearMeasures")
    const c = new Collector(3)
    for (let i = 0; i < 5; i++) c.record(raw({ wallMs: i }))
    expect(c.spans().length).toBe(3)
    expect(c.spans()[0].wallMs).toBe(2)
    expect(c.ledger.totals.calls).toBe(5)
    expect(clear).toHaveBeenCalledWith("webmcp:demo#0")
    expect(clear).toHaveBeenCalledWith("webmcp:demo#1")
    clear.mockRestore()
  })

  it("stamps the session id and sequence on every span", () => {
    const c = new Collector({ sessionId: "0badcafe" })
    const a = c.record(raw())
    const b = c.record(raw())
    expect(a.sessionId).toBe("0badcafe")
    expect([a.seq, b.seq]).toEqual([0, 1])
    expect(c.ledger.sessionId).toBe("0badcafe")
    expect(new Collector().ledger.sessionId).toMatch(/^[0-9a-f]{8}$/)
  })

  it("produces the versioned report, honours report options, and reset clears it", () => {
    const c = new Collector()
    c.record(raw({ tool: "a" }))
    c.record(raw({ tool: "b" }))
    c.record(raw({ tool: "a" }))
    const report = c.report()
    expect(report.format).toBe(REPORT_FORMAT)
    expect(report.session.id).toBe(c.ledger.sessionId)
    expect(report.tools.length).toBe(2)
    expect(report.spans.length).toBe(3)
    expect(c.report({ spans: false }).spans).toEqual([])
    expect(c.report({ spans: 1 }).spans.map((s) => s.seq)).toEqual([2])
    const onlyA = c.report({ tool: "a" })
    expect(onlyA.spans.every((s) => s.tool === "a")).toBe(true)
    expect(onlyA.tools.map((t) => t.tool)).toEqual(["a"])
    c.toolRegistered("a", 120)
    c.reset()
    expect(c.spans().length).toBe(0)
    expect(c.ledger.totals.calls).toBe(0)
    expect(c.ledger.totals.schemaBytes).toBe(120) // the registry survives a reset
  })

  it("tracks schema bytes through registration and unregistration", () => {
    const c = new Collector()
    c.toolRegistered("a", 100)
    c.toolRegistered("b", 50)
    c.toolRegistered("report", 30, true)
    expect(c.ledger.registeredTools).toEqual(["a", "b", "report"])
    expect(c.ledger.totals.schemaBytes).toBe(180)
    expect(c.ledger.totals.estSchemaTokens).toBe(45)
    expect(c.ledger.tools.report.internal).toBe(true)
    c.toolUnregistered("a")
    expect(c.ledger.registeredTools).toEqual(["b", "report"])
    expect(c.ledger.tools.a.unregisteredAt).not.toBeNull()
    expect(c.ledger.totals.schemaBytes).toBe(80)
    c.reconcileRegistered(["b"])
    expect(c.ledger.registeredTools).toEqual(["b"])
    // a stale answer must not remove a tool registered after it was asked for
    const issuedAt = performance.now()
    c.toolRegistered("c", 10)
    c.reconcileRegistered([], issuedAt)
    expect(c.ledger.registeredTools).toEqual(["c"])
    // equal timestamps (coarsened clocks) count as registered after the query
    c.reconcileRegistered([], c.ledger.tools.c.registeredAt)
    expect(c.ledger.registeredTools).toEqual(["c"])
    c.toolRegistered("a", 100) // re-registration reopens the record
    expect(c.ledger.tools.a.unregisteredAt).toBeNull()
  })

  it("attributes a Long Task to each overlapping span but counts the union once in the ledger", () => {
    const c = new Collector()
    const updates: unknown[] = []
    c.onUpdate((u) => updates.push(u))
    c.record(raw({ tool: "a", invokedAt: 1000, settledAt: 1100 }))
    c.record(raw({ tool: "b", invokedAt: 1050, settledAt: 1150 }))
    c.attributeLongTask(1000, 1150)
    const [a, b] = c.spans()
    expect(a.blockingMs).toBe(100)
    expect(b.blockingMs).toBe(100)
    expect(c.ledger.totals.blockingMs).toBe(150)
    expect(updates).toHaveLength(2)
    expect(updates[0]).toMatchObject({ sessionId: c.ledger.sessionId, blockingMs: 100 })
  })

  it("uses the token estimator for every kind", () => {
    const c = new Collector({ tokenEstimator: ({ kind, bytes }) => (kind === "text" ? bytes : 0) })
    c.toolRegistered("a", 10)
    expect(c.ledger.totals.estSchemaTokens).toBe(10)
  })

  it("report() is a snapshot: an earlier report does not change as the session continues", () => {
    const c = new Collector()
    c.toolRegistered("a", 10)
    c.record(raw())
    const base = c.report()
    c.record(raw({ invokedAt: 500, settledAt: 505 }))
    c.toolRegistered("b", 20)
    expect(base.ledger.totals.calls).toBe(1)
    expect(base.ledger.registeredTools).toEqual(["a"])
    expect(base.spans).toHaveLength(1)
    expect(c.report().ledger.totals.calls).toBe(2)
  })

  it("keeps update listeners isolated from each other", () => {
    const c = new Collector()
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const seen: unknown[] = []
    c.onUpdate(() => {
      throw new Error("boom")
    })
    c.onUpdate((u) => seen.push(u))
    c.record(raw({ invokedAt: 0, settledAt: 100 }))
    c.attributeLongTask(10, 50)
    expect(seen).toHaveLength(1)
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })

  it("keeps listeners isolated from each other", () => {
    const c = new Collector()
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const seen: Span[] = []
    c.onSpan(() => {
      throw new Error("boom")
    })
    c.onSpan((s) => seen.push(s))
    c.record(raw())
    expect(seen).toHaveLength(1)
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
})

describe("utf8Length", () => {
  it("matches TextEncoder for ASCII, CJK, and emoji", () => {
    for (const s of ["hello", "{\"a\":1}", "陶器のマグ", "🫖 teapot ☕", "mixed 漢字 and 😀 and ascii"]) {
      expect(utf8Length(s)).toBe(new TextEncoder().encode(s).byteLength)
    }
  })
})

describe("pure aggregation helpers", () => {
  it("aggregateSpans and totalsFromSpans agree with the collector", () => {
    const c = new Collector()
    c.record(raw({ invokedAt: 0, settledAt: 5 }))
    c.record(raw({ invokedAt: 100, settledAt: 110, wallMs: 10 }))
    const agg = aggregateSpans(c.spans())
    expect(agg[0].calls).toBe(2)
    expect(agg[0].p50Ms).toBe(10)
    const totals = totalsFromSpans(c.spans())
    expect(totals.calls).toBe(2)
    expect(totals.hostGapMs).toBe(95)
    expect(totals.estTokens).toBe(c.ledger.totals.estTokens)
  })
})
