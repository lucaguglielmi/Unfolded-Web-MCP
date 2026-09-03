// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { Collector } from "./core/collector"
import { PROFILER_INTERNAL, instrumentMap, instrumentTool, schemaBytesOf, startInterception, type ToolLike, type WrapOptions } from "./core/interceptor"
import { createFakeHost, type FakeHost } from "./testing"

const setup = (over: Partial<WrapOptions> = {}): WrapOptions => ({
  collector: new Collector(),
  originals: new Map(),
  sample: 1,
  errorPolicy: "message",
  ...over,
})

describe("instrumentTool", () => {
  it("measures a call and passes the result through untouched", async () => {
    const opts = setup()
    const result = { content: [{ type: "text", text: "hi" }, { type: "image", data: "x".repeat(80), mimeType: "image/png" }] }
    const tool: ToolLike = { name: "t", description: "d", inputSchema: { type: "object" }, execute: async () => result }
    instrumentTool(tool, opts)
    expect(await tool.execute({ a: 1 })).toBe(result)
    const [span] = opts.collector.spans()
    expect(span.tool).toBe("t")
    expect(span.wallMs).toBeGreaterThanOrEqual(0)
    expect(span.contentTypes).toEqual({ text: 1, image: 1 })
    expect(span.imageBytes).toBe(80)
    expect(span.resultBytes).toBe(JSON.stringify(result).length)
    expect(span.estImageTokens).toBe(Math.ceil((80 * 0.75) / 4))
    expect(span.estTextTokens).toBe(Math.ceil((span.resultBytes - 80) / 4))
    expect(span.estInputTokens).toBe(Math.ceil(JSON.stringify({ a: 1 }).length / 4))
    expect(span.estTokens).toBe(span.estInputTokens + span.estTextTokens + span.estImageTokens)
    expect(span.serializable).toBe(true)
    expect(opts.collector.ledger.registeredTools).toEqual(["t"])
    expect(opts.collector.ledger.tools.t.schemaBytes).toBe(schemaBytesOf(tool))
    expect(schemaBytesOf(tool)).toBeGreaterThan(20)
  })

  it("serializes the input once and the result once", async () => {
    const opts = setup()
    const tool: ToolLike = { name: "t", execute: async () => ({ content: [{ type: "text", text: "x" }] }) }
    instrumentTool(tool, opts)
    const spy = vi.spyOn(JSON, "stringify")
    await tool.execute({ a: 1 })
    expect(spy).toHaveBeenCalledTimes(2)
    spy.mockRestore()
  })

  it("counts UTF-8 bytes, not code units", async () => {
    const opts = setup()
    const text = "陶器のマグ 🫖"
    const tool: ToolLike = { name: "t", execute: async () => ({ content: [{ type: "text", text }] }) }
    instrumentTool(tool, opts)
    await tool.execute({ q: text })
    const [span] = opts.collector.spans()
    expect(span.inputBytes).toBe(new TextEncoder().encode(JSON.stringify({ q: text })).byteLength)
    expect(span.resultBytes).toBeGreaterThan(JSON.stringify({ content: [{ type: "text", text }] }).length)
  })

  it("records a non-serializable result as such instead of throwing", async () => {
    const opts = setup()
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    const tool: ToolLike = { name: "t", execute: async () => cyclic }
    instrumentTool(tool, opts)
    expect(await tool.execute({})).toBe(cyclic)
    expect(opts.collector.spans()[0]).toMatchObject({ resultBytes: 0, serializable: false })
  })

  it("records a thrown execute per errorPolicy and rethrows", async () => {
    for (const [policy, expected] of [
      ["message", "nope"],
      ["name", "Error"],
      ["none", null],
    ] as const) {
      const opts = setup({ errorPolicy: policy })
      const tool: ToolLike = {
        name: "boom",
        execute: () => {
          throw new Error("nope")
        },
      }
      instrumentTool(tool, opts)
      await expect(tool.execute({})).rejects.toThrow("nope")
      const [span] = opts.collector.spans()
      expect(span.isError).toBe(true)
      expect(span.error).toBe(expected)
    }
  })

  it("caps error messages at 200 characters and never keeps a stack", async () => {
    const opts = setup()
    const tool: ToolLike = {
      name: "boom",
      execute: () => {
        throw new Error("x".repeat(500))
      },
    }
    instrumentTool(tool, opts)
    await expect(tool.execute({})).rejects.toThrow()
    const [span] = opts.collector.spans()
    expect(span.error!.length).toBe(201)
    expect(JSON.stringify(span)).not.toContain("at ")
  })

  it("wraps once, preserves name and length, and originals restore on unwrap", async () => {
    const opts = setup()
    const execute = async function myExecute(_input: unknown) {
      return { content: [] }
    }
    const tool: ToolLike = { name: "t", execute }
    instrumentTool(tool, opts)
    const wrapped = tool.execute
    instrumentTool(tool, opts)
    expect(tool.execute).toBe(wrapped)
    expect(tool.execute.name).toBe("myExecute")
    expect(tool.execute.length).toBe(1)
    for (const [t, original] of opts.originals) t.execute = original
    expect(tool.execute).toBe(execute)
  })

  it("forwards every argument: the host's options bag reaches the tool untouched", async () => {
    const opts = setup()
    const seen: unknown[][] = []
    const tool = {
      name: "t",
      execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
        seen.push([input, options])
        return { content: [] }
      },
    }
    instrumentTool(tool, opts)
    const options = { signal: new AbortController().signal }
    await tool.execute({ a: 1 }, options)
    expect(seen[0][0]).toEqual({ a: 1 })
    expect(seen[0][1]).toBe(options)
    expect(opts.collector.spans()[0].inputBytes).toBe(JSON.stringify({ a: 1 }).length)
  })

  it("accepts a typed descriptor (method syntax keeps ToolLike bivariant)", async () => {
    interface MyInput {
      capacityMl: number
    }
    const typed = { name: "set_capacity", execute: async (input: MyInput) => ({ content: [], ml: input.capacityMl }) }
    const registry: Record<string, ToolLike> = { set_capacity: typed }
    const single: ToolLike = typed
    const opts = setup()
    expect(instrumentMap(registry, opts)).toBe(1)
    expect(single.name).toBe("set_capacity")
    await registry.set_capacity.execute({ capacityMl: 350 })
    expect(opts.collector.spans()).toHaveLength(1)
  })

  it("samples: sample 0 records nothing but counts calls", async () => {
    const opts = setup({ sample: 0 })
    const tool: ToolLike = { name: "t", execute: async () => ({ content: [] }) }
    instrumentTool(tool, opts)
    await tool.execute({})
    await tool.execute({})
    expect(opts.collector.spans()).toHaveLength(0)
    expect(opts.collector.ledger.totals.calls).toBe(2)
    expect(opts.collector.ledger.totals.unsampledCalls).toBe(2)
  })

  it("lists an internal tool without wrapping it", () => {
    const opts = setup()
    const execute = async () => ({ content: [] })
    const tool = { name: "get_perf_report", execute }
    Object.defineProperty(tool, PROFILER_INTERNAL, { value: true, enumerable: false })
    instrumentTool(tool, opts)
    expect(tool.execute).toBe(execute)
    expect(opts.collector.ledger.tools.get_perf_report.internal).toBe(true)
  })
})

describe("startInterception with the fake host", () => {
  let host: FakeHost | null = null
  afterEach(() => {
    host?.uninstall()
    host = null
    vi.restoreAllMocks()
  })

  it("patched registerTool passes options through, including exposedTo and the signal", async () => {
    host = createFakeHost({ async: false })
    const opts = setup()
    const interception = startInterception(opts)
    const tool: ToolLike = { name: "t", inputSchema: { type: "object", properties: { a: { type: "number" } } }, execute: async () => ({ content: [] }) }
    const schema = JSON.stringify(tool.inputSchema)
    const controller = new AbortController()
    const options = { signal: controller.signal, exposedTo: ["https://agent.example"] }
    await (document as unknown as { modelContext: { registerTool: (t: ToolLike, o?: unknown) => Promise<void> } }).modelContext.registerTool(tool, options)
    expect(host.registrations[0]).toMatchObject({ method: "registerTool", name: "t" })
    expect(host.registrations[0].options).toBe(options)
    expect(JSON.stringify(tool.inputSchema)).toBe(schema)
    expect(opts.collector.ledger.hostLocation).toBe("document")
    expect(opts.collector.ledger.registeredTools).toEqual(["t"])
    controller.abort()
    expect(opts.collector.ledger.registeredTools).toEqual([])
    expect(host.tools.has("t")).toBe(false)
    interception.stop()
    interception.unpatchAll()
  })

  it("a superseded registration's abort does not unregister a re-registered tool (StrictMode remount)", async () => {
    host = createFakeHost({ async: false })
    const opts = setup()
    const interception = startInterception(opts)
    const registry = host.registry as { registerTool: (t: ToolLike, o?: { signal: AbortSignal }) => Promise<void> }
    const tool: ToolLike = { name: "t", execute: async () => ({}) }
    const first = new AbortController()
    const second = new AbortController()
    await registry.registerTool(tool, { signal: first.signal })
    await registry.registerTool(tool, { signal: second.signal }) // already wrapped: the ledger record stays open
    expect(opts.collector.ledger.registeredTools).toEqual(["t"])
    first.abort()
    expect(opts.collector.ledger.registeredTools).toEqual(["t"])
    second.abort()
    expect(opts.collector.ledger.registeredTools).toEqual([])
    await registry.registerTool(tool, { signal: new AbortController().signal })
    expect(opts.collector.ledger.registeredTools).toEqual(["t"])
    expect(opts.collector.ledger.tools.t.unregisteredAt).toBeNull()
    interception.stop()
    interception.unpatchAll()
  })

  it("a burst of registrations on an async host all reach the ledger (registration on acceptance)", async () => {
    host = createFakeHost() // async: each registerTool resolves on a later tick
    const opts = setup()
    const interception = startInterception(opts)
    const registry = host.registry as { registerTool: (t: ToolLike) => Promise<void> }
    const names = ["t1", "t2", "t3", "t4", "t5"]
    await Promise.all(names.map((name) => registry.registerTool({ name, description: "d", execute: async () => ({}) })))
    await new Promise((r) => setTimeout(r, 20)) // let every toolchange reconcile settle
    expect(opts.collector.ledger.registeredTools).toEqual(names)
    expect(opts.collector.ledger.totals.schemaBytes).toBeGreaterThan(5 * 20)
    interception.stop()
    interception.unpatchAll()
  })

  it("registrations the host does not accept never enter the ledger", async () => {
    host = createFakeHost({ async: false })
    const opts = setup()
    const interception = startInterception(opts)
    const registry = host.registry as { registerTool: (t: unknown, o?: unknown) => Promise<void> }
    const aborted = new AbortController()
    aborted.abort()
    await registry.registerTool({ name: "dead", execute: async () => ({}) }, { signal: aborted.signal })
    await registry.registerTool({ execute: async () => ({}) }).catch(() => undefined) // no name: the host rejects
    await expect(registry.registerTool(null)).rejects.toThrow()
    expect(opts.collector.ledger.registeredTools).toEqual([])
    // a call that lands before the host's promise settles is still measured
    const late = { name: "late", execute: async (_input?: unknown) => ({ content: [] }) }
    const pending = registry.registerTool(late)
    await late.execute({})
    await pending
    expect(opts.collector.spans().map((s) => s.tool)).toEqual(["late"])
    expect(opts.collector.ledger.registeredTools).toEqual(["late"])
    interception.stop()
    interception.unpatchAll()
  })

  it("provideContext replaces the tool set", async () => {
    host = createFakeHost({ legacy: true })
    const opts = setup()
    const interception = startInterception(opts)
    const registry = host.registry as { provideContext: (c: { tools: ToolLike[] }) => void }
    registry.provideContext({ tools: [{ name: "a", execute: async () => ({}) }, { name: "b", execute: async () => ({}) }] })
    expect(opts.collector.ledger.registeredTools).toEqual(["a", "b"])
    registry.provideContext({ tools: [{ name: "c", execute: async () => ({}) }] })
    expect(opts.collector.ledger.registeredTools).toEqual(["c"])
    expect(opts.collector.ledger.tools.a.unregisteredAt).not.toBeNull()
    interception.stop()
    interception.unpatchAll()
  })

  it("tracks unregisterTool, clearContext-style hosts, and toolchange reconciliation", async () => {
    host = createFakeHost({ async: false })
    const opts = setup()
    const interception = startInterception(opts)
    const registry = host.registry as { registerTool: (t: ToolLike) => Promise<void>; unregisterTool: (n: string) => Promise<void> }
    await registry.registerTool({ name: "a", execute: async () => ({}) })
    await registry.registerTool({ name: "b", execute: async () => ({}) })
    expect(opts.collector.ledger.registeredTools).toEqual(["a", "b"])
    await registry.unregisterTool("a")
    expect(opts.collector.ledger.registeredTools).toEqual(["b"])
    // the host drops a tool on its own: toolchange + getTools reconcile the ledger
    host.unregister("b")
    await new Promise((r) => setTimeout(r, 10))
    expect(opts.collector.ledger.registeredTools).toEqual([])
    interception.stop()
    interception.unpatchAll()
  })

  it("legacy provideContext hosts are wrapped and clearContext empties the registry", async () => {
    host = createFakeHost({ legacy: true, location: "navigator" })
    const opts = setup()
    const interception = startInterception(opts)
    const registry = host.registry as { provideContext: (c: { tools: ToolLike[] }) => void; clearContext: () => void }
    const tool: ToolLike = { name: "legacy", execute: async () => ({ content: [] }) }
    registry.provideContext({ tools: [tool] })
    expect(opts.collector.ledger.hostLocation).toBe("navigator")
    await tool.execute({})
    expect(opts.collector.spans()).toHaveLength(1)
    registry.clearContext()
    expect(opts.collector.ledger.registeredTools).toEqual([])
    interception.stop()
    interception.unpatchAll()
  })

  it("stops polling once every location holds a registry or the document one is native", () => {
    const opts = setup()
    const interception = startInterception(opts, { pollMs: 5 })
    expect(interception.polling()).toBe(true)
    interception.stop()
    expect(interception.polling()).toBe(false)
  })
})
