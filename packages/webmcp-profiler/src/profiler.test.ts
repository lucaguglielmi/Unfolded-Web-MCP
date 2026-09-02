import { afterEach, describe, expect, it, vi } from "vitest"
import { Collector, REPORT_FORMAT, type Span } from "./collector"
import { attachProfiler } from "./index"
import { instrumentMap, instrumentTool, startInterception, type ToolLike } from "./interceptor"

const baseSpan = (over: Partial<Span> = {}): Omit<Span, "seq" | "gapSincePrevCallMs"> => ({
  tool: "demo",
  invokedAt: 100,
  settledAt: 105,
  wallMs: 5,
  blockingMs: 0,
  inputBytes: 10,
  resultBytes: 400,
  contentTypes: { text: 1 },
  imageBytes: 0,
  estTokens: 100,
  isError: false,
  error: null,
  synthetic: false,
  ...over,
})

describe("Collector", () => {
  it("aggregates per tool with percentiles and totals", () => {
    const c = new Collector()
    for (let i = 1; i <= 10; i++) {
      c.record(baseSpan({ wallMs: i, invokedAt: i * 100, settledAt: i * 100 + i }))
    }
    c.record(baseSpan({ tool: "other", wallMs: 50, isError: true }))

    const byTool = Object.fromEntries(c.aggregates().map((a) => [a.tool, a]))
    expect(byTool.demo.calls).toBe(10)
    expect(byTool.demo.minMs).toBe(1)
    expect(byTool.demo.maxMs).toBe(10)
    expect(byTool.demo.p50Ms).toBe(6)
    expect(byTool.other.errors).toBe(1)
    expect(c.ledger.totals.calls).toBe(11)
    expect(c.ledger.totals.errors).toBe(1)
    expect(c.ledger.totals.estTokens).toBe(1100)
  })

  it("computes host gaps from settle to next invoke — the model think time", () => {
    const c = new Collector()
    c.record(baseSpan({ invokedAt: 100, settledAt: 110 }))
    const second = c.record(baseSpan({ invokedAt: 4110, settledAt: 4115 }))
    expect(second.gapSincePrevCallMs).toBe(4000)
    expect(c.ledger.totals.hostGapMs).toBe(4000)
    expect(c.ledger.firstCallAt).toBe(100)
  })

  it("keeps only the newest spans past the buffer size", () => {
    const c = new Collector(3)
    for (let i = 0; i < 5; i++) c.record(baseSpan({ wallMs: i }))
    expect(c.spans().length).toBe(3)
    expect(c.spans()[0].wallMs).toBe(2)
    // totals still count everything, buffered or not
    expect(c.ledger.totals.calls).toBe(5)
  })

  it("produces the versioned report and reset clears it", () => {
    const c = new Collector()
    c.record(baseSpan())
    const report = c.report() as { format: string; tools: unknown[]; spans: unknown[] }
    expect(report.format).toBe(REPORT_FORMAT)
    expect(report.tools.length).toBe(1)
    c.reset()
    expect(c.spans().length).toBe(0)
    expect(c.ledger.totals.calls).toBe(0)
  })
})

describe("instrumentTool", () => {
  const setup = () => {
    const collector = new Collector()
    const originals = new Map<ToolLike, ToolLike["execute"]>()
    return { collector, originals }
  }

  it("measures a call and passes the result through untouched", async () => {
    const { collector, originals } = setup()
    const result = { content: [{ type: "text", text: "hi" }, { type: "image", data: "x".repeat(80) }] }
    const tool: ToolLike = { name: "t", execute: async () => result }
    instrumentTool(tool, collector, originals)

    expect(await tool.execute({ a: 1 })).toBe(result)
    const [span] = collector.spans()
    expect(span.tool).toBe("t")
    expect(span.wallMs).toBeGreaterThanOrEqual(0)
    expect(span.contentTypes).toEqual({ text: 1, image: 1 })
    expect(span.imageBytes).toBe(80)
    expect(span.estTokens).toBe(Math.ceil(JSON.stringify(result).length / 4))
    expect(collector.ledger.registeredTools).toEqual(["t"])
  })

  it("records a thrown execute as an error span and rethrows", async () => {
    const { collector, originals } = setup()
    const tool: ToolLike = {
      name: "boom",
      execute: () => {
        throw new Error("nope")
      },
    }
    instrumentTool(tool, collector, originals)
    await expect(tool.execute({})).rejects.toThrow("nope")
    const [span] = collector.spans()
    expect(span.isError).toBe(true)
    expect(span.error).toBe("nope")
  })

  it("wraps once, and originals restore on unwrap", async () => {
    const { collector, originals } = setup()
    const execute = async () => ({ content: [] })
    const tool: ToolLike = { name: "t", execute }
    instrumentTool(tool, collector, originals)
    const wrapped = tool.execute
    instrumentTool(tool, collector, originals)
    expect(tool.execute).toBe(wrapped) // idempotent

    for (const [t, original] of originals) t.execute = original
    expect(tool.execute).toBe(execute)
  })

  it("forwards every argument — the host's options bag reaches the tool untouched", async () => {
    const { collector, originals } = setup()
    const seen: unknown[][] = []
    const tool = {
      name: "t",
      execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
        seen.push([input, options])
        return { content: [] }
      },
    }
    instrumentTool(tool, collector, originals)

    const options = { signal: new AbortController().signal }
    await tool.execute({ a: 1 }, options)
    expect(seen).toHaveLength(1)
    expect(seen[0][0]).toEqual({ a: 1 })
    expect(seen[0][1]).toBe(options)
    // the span weighs the input alone, never the options bag
    expect(collector.spans()[0].inputBytes).toBe(JSON.stringify({ a: 1 }).length)
  })

  it("instrumentMap retrofits a {name: tool} registry", async () => {
    const { collector, originals } = setup()
    const registry: Record<string, ToolLike> = {
      a: { name: "a", execute: async () => ({ content: [] }) },
      b: { name: "b", execute: async () => ({ content: [] }) },
    }
    expect(instrumentMap(registry, collector, originals)).toBe(2)
    await registry.a.execute({})
    await registry.b.execute({})
    expect(collector.spans().length).toBe(2)
  })
})

/**
 * The registry watcher reads document / navigator / window globals, so a
 * fake host is stubbed onto globalThis for these (no DOM in the runner).
 */
describe("startInterception", () => {
  const fakeHost = () => {
    const calls: unknown[][] = []
    const registry = {
      registerTool: (...args: unknown[]) => {
        calls.push(args)
        return Promise.resolve()
      },
      provideContext: (...args: unknown[]) => {
        calls.push(args)
      },
    }
    vi.stubGlobal("window", { setInterval, clearInterval })
    vi.stubGlobal("document", { modelContext: registry })
    vi.stubGlobal("navigator", {})
    return { registry, calls }
  }

  afterEach(() => vi.unstubAllGlobals())

  it("patched registerTool / provideContext pass their options through to the host", async () => {
    const { registry, calls } = fakeHost()
    const interception = startInterception(new Collector())

    const tool: ToolLike = { name: "t", execute: async () => ({ content: [] }) }
    const opts = { signal: new AbortController().signal }
    await registry.registerTool(tool, opts)
    registry.provideContext({ tools: [tool] }, opts)

    expect(calls).toHaveLength(2)
    expect(calls[0][0]).toBe(tool)
    expect(calls[0][1]).toBe(opts)
    expect(calls[1][1]).toBe(opts)
    interception.stop()
  })

  it("detach puts the registry's own methods back, and a re-attach instruments again", async () => {
    const { registry, calls } = fakeHost()
    const originalRegister = registry.registerTool
    const originalProvide = registry.provideContext
    const execute = async (_input: unknown) => ({ content: [] })
    const tool = { name: "t", execute }

    const first = attachProfiler({ relay: false })
    expect(registry.registerTool).not.toBe(originalRegister)
    await registry.registerTool(tool)
    expect(tool.execute).not.toBe(execute)

    first.detach()
    expect(registry.registerTool).toBe(originalRegister)
    expect(registry.provideContext).toBe(originalProvide)
    expect(tool.execute).toBe(execute)
    expect(window.__webmcpPerf).toBeUndefined()

    const second = attachProfiler({ relay: false })
    expect(registry.registerTool).not.toBe(originalRegister)
    await registry.registerTool(tool)
    await tool.execute({})
    expect(second.spans()).toHaveLength(1)
    expect(calls).toHaveLength(2) // the host saw each registration once

    second.detach()
    expect(registry.registerTool).toBe(originalRegister)
    expect(tool.execute).toBe(execute)
  })
})
