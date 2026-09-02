// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { FAKE_HOST_INIT_SCRIPT, createFakeHost, fakeHostInitScript, type FakeHost } from "./testing"
import type { ToolLike } from "./core/interceptor"

let host: FakeHost | null = null
afterEach(() => {
  host?.uninstall()
  host = null
  delete (window as unknown as Record<string, unknown>).__webmcpFakeHost
  delete (window as unknown as Record<string, unknown>).__mcpTools
})

const tool = (name: string): ToolLike => ({ name, description: `${name} desc`, inputSchema: { type: "object" }, execute: async (input: unknown) => ({ content: [], input }) })

describe("createFakeHost", () => {
  it("installs on document by default and honours the draft's registerTool contract", async () => {
    host = createFakeHost()
    const registry = (document as Document & { modelContext: FakeHost["registry"] }).modelContext
    expect(registry).toBe(host.registry)
    const controller = new AbortController()
    const p = (registry.registerTool as (t: ToolLike, o?: unknown) => Promise<void>)(tool("a"), { signal: controller.signal })
    expect(p).toBeInstanceOf(Promise)
    expect(host.tools.has("a")).toBe(false) // async: lands on a later tick
    await p
    expect(host.tools.has("a")).toBe(true)
    expect(host.registrations[0]).toMatchObject({ method: "registerTool", name: "a" })
    controller.abort()
    expect(host.tools.has("a")).toBe(false)
  })

  it("answers getTools() with same-origin records and fires toolchange", async () => {
    host = createFakeHost({ async: false })
    let changes = 0
    ;(host.registry.addEventListener as (t: string, f: () => void) => void)("toolchange", () => changes++)
    await (host.registry.registerTool as (t: ToolLike) => Promise<void>)(tool("a"))
    const list = (await (host.registry.getTools as () => Promise<{ name: string; origin: string }[]>)()) as { name: string; origin: string }[]
    expect(list.map((t) => t.name)).toEqual(["a"])
    expect(typeof list[0].origin).toBe("string")
    await (host.registry.unregisterTool as (n: string) => Promise<void>)("a")
    expect(changes).toBe(2)
  })

  it("call() passes an options bag with a signal, like a host", async () => {
    host = createFakeHost({ async: false })
    let seenSignal: unknown
    await (host.registry.registerTool as (t: ToolLike) => Promise<void>)({
      name: "s",
      execute: async (_input: unknown, options?: { signal?: AbortSignal }) => {
        seenSignal = options?.signal
        return { content: [] }
      },
    })
    await host.call("s", {})
    expect(seenSignal).toBeInstanceOf(AbortSignal)
    await expect(host.call("missing")).rejects.toThrow("no tool named missing")
  })

  it("legacy shape exposes provideContext and clearContext only", () => {
    host = createFakeHost({ legacy: true, location: "navigator" })
    const registry = (navigator as Navigator & { modelContext: FakeHost["registry"] }).modelContext
    expect(registry.registerTool).toBeUndefined()
    ;(registry.provideContext as (c: { tools: ToolLike[] }) => void)({ tools: [tool("a"), tool("b")] })
    expect([...host.tools.keys()]).toEqual(["a", "b"])
    ;(registry.clearContext as () => void)()
    expect(host.tools.size).toBe(0)
  })

  it("mirror and expose keep globals in sync; uninstall restores everything", async () => {
    const before = (document as Document & { modelContext?: unknown }).modelContext
    host = createFakeHost({ async: false, mirror: "__mcpTools", expose: "__webmcpFakeHost" })
    await (host.registry.registerTool as (t: ToolLike) => Promise<void>)(tool("a"))
    const g = window as unknown as Record<string, unknown>
    expect((g.__mcpTools as Record<string, ToolLike>).a.name).toBe("a")
    expect(g.__webmcpFakeHost).toBe(host)
    host.uninstall()
    host = null
    expect((document as Document & { modelContext?: unknown }).modelContext).toBe(before)
    expect(g.__mcpTools).toBeUndefined()
    expect(g.__webmcpFakeHost).toBeUndefined()
  })

  it("the init script is self-contained and installs the same host", async () => {
    expect(FAKE_HOST_INIT_SCRIPT).toContain("__webmcpFakeHost")
    new Function(FAKE_HOST_INIT_SCRIPT)()
    const g = window as unknown as { __webmcpFakeHost: FakeHost; __mcpTools: Record<string, ToolLike> }
    expect(g.__webmcpFakeHost).toBeDefined()
    await (g.__webmcpFakeHost.registry.registerTool as (t: ToolLike) => Promise<void>)(tool("a"))
    expect(g.__mcpTools.a).toBeDefined()
    expect(await g.__webmcpFakeHost.call("a", { x: 1 })).toMatchObject({ input: { x: 1 } })
    g.__webmcpFakeHost.uninstall()
    expect(fakeHostInitScript({ legacy: true })).toContain('"legacy":true')
  })
})
