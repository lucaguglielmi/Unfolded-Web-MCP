// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { attachProfiler, type Profiler } from "./index"
import { profilerTool } from "./tool"
import { createFakeHost, type FakeHost } from "./testing"

let host: FakeHost
let profiler: Profiler
afterEach(() => {
  profiler?.detach()
  host?.uninstall()
})

const setup = async () => {
  host = createFakeHost({ async: false })
  profiler = attachProfiler({ relay: false })
  const registry = host.registry as { registerTool: (t: unknown) => Promise<void> }
  const demo = { name: "demo", description: "d", inputSchema: { type: "object" }, execute: async (_input?: unknown) => ({ content: [{ type: "text", text: "x".repeat(300) }] }) }
  await registry.registerTool(demo)
  await registry.registerTool(profilerTool(profiler))
  await demo.execute({})
  await demo.execute({})
}

describe("profilerTool", () => {
  it("is listed as internal, never wrapped, and never measured", async () => {
    await setup()
    const ledger = profiler.ledger()
    expect(ledger.registeredTools).toEqual(["demo", "get_perf_report"])
    expect(ledger.tools.get_perf_report.internal).toBe(true)
    expect(ledger.tools.get_perf_report.schemaBytes).toBeGreaterThan(200)
    await host.call("get_perf_report", {})
    expect(profiler.spans().map((s) => s.tool)).toEqual(["demo", "demo"])
  })

  it("summary view: text summary plus a small structured document", async () => {
    await setup()
    const result = (await host.call("get_perf_report", {})) as { content: { type: string; text: string }[]; structuredContent: Record<string, unknown> }
    expect(result.content[0].text).toContain("payloads")
    expect(result.content[0].text).toContain("demo")
    const sc = result.structuredContent as { ok: boolean; format: string; split: string; tools?: unknown; spans?: unknown; meta: { view: string; resultBytes: number; estTokens: number } }
    expect(sc.ok).toBe(true)
    expect(sc.format).toBe("webmcp-perf-report/2")
    expect(sc.split).toContain("tools")
    expect(sc.tools).toBeUndefined()
    expect(sc.spans).toBeUndefined()
    expect(sc.meta.view).toBe("summary")
    expect(sc.meta.resultBytes).toBeLessThan(2048)
    expect(sc.meta.estTokens).toBe(Math.ceil(sc.meta.resultBytes / 4))
  })

  it("tools and spans views, with tool, limit, and since filters", async () => {
    await setup()
    const tools = (await host.call("get_perf_report", { view: "tools" })) as { structuredContent: { tools: { tool: string }[] } }
    expect(tools.structuredContent.tools.map((t) => t.tool)).toEqual(["demo"])
    const spans = (await host.call("get_perf_report", { view: "spans", limit: 1 })) as { structuredContent: { spans: { seq: number }[]; truncated: boolean } }
    expect(spans.structuredContent.spans.map((s) => s.seq)).toEqual([1])
    expect(spans.structuredContent.truncated).toBe(true)
    const since = (await host.call("get_perf_report", { view: "spans", since: 0 })) as { structuredContent: { spans: { seq: number }[]; truncated: boolean } }
    expect(since.structuredContent.spans.map((s) => s.seq)).toEqual([1])
    expect(since.structuredContent.truncated).toBe(false)
    const none = (await host.call("get_perf_report", { view: "spans", tool: "nope" })) as { structuredContent: { spans: unknown[] } }
    expect(none.structuredContent.spans).toEqual([])
  })

  it("has a read-only annotation, a schema, and registers its name for describe()", async () => {
    await setup()
    const descriptor = profilerTool(profiler, { name: "perf" })
    expect(descriptor.annotations.readOnlyHint).toBe(true)
    expect((descriptor.inputSchema.properties as Record<string, unknown>).view).toBeDefined()
    expect((await profiler.describe()).tool?.name).toBe("perf")
  })
})
