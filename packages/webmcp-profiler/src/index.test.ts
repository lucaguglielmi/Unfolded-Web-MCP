// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { DEFAULTS, attachProfiler, type Profiler, type Span } from "./index"
import { profilerTool } from "./tool"
import { createFakeHost, type FakeHost } from "./testing"
import { METHOD_DOCS, SPAN_FIELDS, LEDGER_FIELDS, CONFIG_DOCS, describe as describeSync } from "./docs"

let host: FakeHost | null = null
let profiler: Profiler | null = null
afterEach(() => {
  profiler?.detach()
  profiler = null
  host?.uninstall()
  host = null
  vi.restoreAllMocks()
})

const registerDemo = async (name = "demo", execute: (input?: unknown) => Promise<unknown> = async () => ({ content: [{ type: "text", text: "hi" }] })) => {
  const tool = { name, description: "demo tool", inputSchema: { type: "object" }, execute }
  await (host!.registry as { registerTool: (t: unknown) => Promise<void> }).registerTool(tool)
  return tool
}

describe("attachProfiler", () => {
  it("is idempotent: a second call returns the active instance and warns", async () => {
    host = createFakeHost({ async: false })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    profiler = attachProfiler({ relay: false })
    const again = attachProfiler({ relay: false })
    expect(again).toBe(profiler)
    expect(warn).toHaveBeenCalledOnce()
    const tool = await registerDemo()
    await tool.execute({})
    expect(profiler.spans()).toHaveLength(1)
    expect(window.__webmcpPerf).toBe(profiler)
  })

  it("moves through the status phases with actionable messages", async () => {
    profiler = attachProfiler({ relay: false })
    expect(profiler.status().phase).toBe("no-host")
    expect(profiler.status().hints.length).toBeGreaterThan(0)
    host = createFakeHost({ async: false })
    await new Promise((r) => setTimeout(r, DEFAULTS.pollMs + 50))
    expect(profiler.status().phase).toBe("host-found")
    expect(profiler.status().message).toContain("document")
    const tool = await registerDemo()
    expect(profiler.status().phase).toBe("tools-registered")
    expect(profiler.status().toolCount).toBe(1)
    await tool.execute({})
    const s = profiler.status()
    expect(s.phase).toBe("measuring")
    expect(s.callCount).toBe(1)
    expect(s.message).toContain("payloads")
    profiler.detach()
    expect(profiler.status().phase).toBe("detached")
    expect(profiler.active).toBe(false)
  })

  it("summary() is the split then one line per tool; table() rounds", async () => {
    host = createFakeHost({ async: false })
    profiler = attachProfiler({ relay: false })
    const tool = await registerDemo()
    await tool.execute({})
    const lines = profiler.summary().split("\n")
    expect(lines[0]).toMatch(/^webmcp-profiler · session [0-9a-f]{8} · measuring · 1 tools · 1 calls$/)
    expect(lines[1]).toMatch(/^schemas .* · tools .* · payloads .* · host gaps /)
    expect(lines[2]).toContain("demo")
    const table = vi.spyOn(console, "table").mockImplementation(() => undefined)
    profiler.table()
    const rows = table.mock.calls[0][0] as Record<string, unknown>[]
    expect(rows[0].tool).toBe("demo")
    expect(String(rows[0]["p50 (ms)"]).split(".")[1]?.length ?? 0).toBeLessThanOrEqual(1)
  })

  it("exposes onSpan, onSpanUpdate, ledger(), and the config onSpan", async () => {
    host = createFakeHost({ async: false })
    const fromConfig: Span[] = []
    profiler = attachProfiler({ relay: false, onSpan: (s) => fromConfig.push(s) })
    const seen: Span[] = []
    const off = profiler.onSpan((s) => seen.push(s))
    const tool = await registerDemo()
    await tool.execute({})
    off()
    await tool.execute({})
    expect(seen).toHaveLength(1)
    expect(fromConfig).toHaveLength(2)
    expect(profiler.ledger().registeredTools).toEqual(["demo"])
    expect(profiler.sessionId).toBe(profiler.ledger().sessionId)
    expect(typeof profiler.onSpanUpdate(() => undefined)).toBe("function")
  })

  it("globalName: custom name, or none at all; detach removes it", async () => {
    host = createFakeHost({ async: false })
    profiler = attachProfiler({ relay: false, globalName: "__perf" })
    expect((window as unknown as Record<string, unknown>).__perf).toBe(profiler)
    expect(window.__webmcpPerf).toBeUndefined()
    profiler.detach()
    expect((window as unknown as Record<string, unknown>).__perf).toBeUndefined()
    profiler = attachProfiler({ relay: false, globalName: false })
    expect(window.__webmcpPerf).toBeUndefined()
  })

  it("no bodies: a canary in input and result appears nowhere in report, relay, or hook", async () => {
    host = createFakeHost({ async: false })
    const canary = "CANARY-7f3a9c-DO-NOT-LEAK"
    const relayed: unknown[] = []
    const listener = new BroadcastChannel("webmcp-perf:test-canary")
    listener.onmessage = (e) => relayed.push(e.data)
    const hooked: unknown[] = []
    profiler = attachProfiler({ channel: "webmcp-perf:test-canary", onSpan: (s) => hooked.push(s) })
    const tool = await registerDemo("leaky", async () => ({ content: [{ type: "text", text: `result ${canary}` }] }))
    await tool.execute({ secret: `input ${canary}` })
    await new Promise((r) => setTimeout(r, 20))
    expect(JSON.stringify(profiler.report())).not.toContain(canary)
    expect(JSON.stringify(hooked)).not.toContain(canary)
    expect(relayed.length).toBeGreaterThan(0)
    expect(JSON.stringify(relayed)).not.toContain(canary)
    expect(profiler.summary()).not.toContain(canary)
    listener.close()
  })

  it("describe() is a JSON-serializable manifest that matches the sync docs entry", async () => {
    host = createFakeHost({ async: false })
    profiler = attachProfiler({ relay: false })
    profilerTool(profiler)
    const m = await profiler.describe()
    expect(JSON.parse(JSON.stringify(m))).toEqual(m)
    expect(m.tool?.name).toBe("get_perf_report")
    expect(m.console.global).toBe("__webmcpPerf")
    expect(m.relay.channel).toBe(false)
    expect(m.package.format).toBe("webmcp-perf-report/2")
    expect(describeSync({ relay: false }, "get_perf_report")).toEqual(m)
  })

  it("help() prints the status and every method", async () => {
    host = createFakeHost({ async: false })
    profiler = attachProfiler({ relay: false })
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined)
    await profiler.help()
    const text = String(info.mock.calls[0][0])
    for (const name of Object.keys(METHOD_DOCS)) expect(text).toContain(name)
    expect(text).toContain("registry found")
  })

  it("synthetic() flags spans from then on; reset() keeps the registry", async () => {
    host = createFakeHost({ async: false })
    profiler = attachProfiler({ relay: false })
    const tool = await registerDemo()
    await tool.execute({})
    profiler.synthetic(true)
    await tool.execute({})
    expect(profiler.spans().map((s) => s.synthetic)).toEqual([false, true])
    profiler.reset()
    expect(profiler.spans()).toHaveLength(0)
    expect(profiler.ledger().registeredTools).toEqual(["demo"])
  })
})

describe("the documentation source covers its types", () => {
  it("SPAN_FIELDS has a line for every field of a recorded span", async () => {
    host = createFakeHost({ async: false })
    profiler = attachProfiler({ relay: false })
    const tool = await registerDemo()
    await tool.execute({})
    const [span] = profiler.spans()
    expect(Object.keys(SPAN_FIELDS).sort()).toEqual(Object.keys(span).sort())
  })

  it("LEDGER_FIELDS has a line for every ledger field and total", () => {
    host = createFakeHost({ async: false })
    profiler = attachProfiler({ relay: false })
    const l = profiler.ledger()
    const keys = [...Object.keys(l).filter((k) => k !== "totals"), ...Object.keys(l.totals).map((k) => `totals.${k}`)]
    expect(Object.keys(LEDGER_FIELDS).sort()).toEqual(keys.sort())
  })

  it("METHOD_DOCS has a line for every member of a Profiler and nothing else", () => {
    host = createFakeHost({ async: false })
    profiler = attachProfiler({ relay: false })
    expect(Object.keys(METHOD_DOCS).sort()).toEqual(Object.keys(profiler).sort())
  })

  it("CONFIG_DOCS has a line for every default", () => {
    for (const key of Object.keys(DEFAULTS)) expect(CONFIG_DOCS).toHaveProperty(key)
  })
})

describe("without a window", () => {
  it("attachProfiler returns a frozen no-op profiler", async () => {
    vi.stubGlobal("window", undefined)
    vi.stubGlobal("document", undefined)
    const p = attachProfiler()
    expect(p.active).toBe(false)
    expect(p.spans()).toEqual([])
    expect(p.report().format).toBe("webmcp-perf-report/2")
    expect(p.status().phase).toBe("inactive")
    expect(Object.isFrozen(p)).toBe(true)
    expect(() => p.detach()).not.toThrow()
    vi.unstubAllGlobals()
  })
})
