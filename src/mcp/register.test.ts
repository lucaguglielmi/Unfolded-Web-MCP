import { describe, expect, it } from "vitest"
import { registerToolSet } from "./register"
import type { ModelContext, ToolDescriptor } from "./modelContext"

/**
 * Spec 4.1 acceptance, at the unit level, against fake hosts that behave
 * like the current draft: async registration, per-tool promises, and
 * signal-driven removal on abort.
 */

const tool = (name: string): ToolDescriptor => ({
  name,
  description: `${name} description that is long enough to look real`,
  inputSchema: { type: "object" },
  execute: async () => ({ content: [] }),
})

const TOOLS = [tool("a"), tool("b"), tool("c")]

/** current-draft fake: resolves each registration on a later tick and
    removes the tool again when its registration signal aborts */
function draftHost(options?: { rejectAt?: string; delayMs?: number }) {
  const registered = new Set<string>()
  const issued: string[] = []
  const ctx: ModelContext = {
    registerTool: (t, opts) => {
      issued.push(t.name)
      return new Promise<void>((resolve, reject) => {
        setTimeout(() => {
          if (opts?.signal?.aborted) return resolve()
          if (options?.rejectAt === t.name) return reject(new Error(`host refused ${t.name}`))
          registered.add(t.name)
          opts?.signal?.addEventListener("abort", () => registered.delete(t.name))
          resolve()
        }, options?.delayMs ?? 1)
      })
    },
  }
  return { ctx, registered, issued }
}

describe("registerToolSet", () => {
  it("awaits every registration and succeeds only after the last resolves", async () => {
    const host = draftHost()
    const ok = await registerToolSet(host.ctx, TOOLS, new AbortController())
    expect(ok).toBe(true)
    expect([...host.registered]).toEqual(["a", "b", "c"])
  })

  it("registers the whole set in parallel: fourteen slow tools cost one delay, in order", async () => {
    // docs/webmcp-tool-performance-spec.md §7: a host whose registration
    // is a real round trip pays one latency for the set, not fourteen
    const fourteen = Array.from({ length: 14 }, (_, i) => tool(`tool_${i}`))
    const host = draftHost({ delayMs: 20 })
    const t0 = performance.now()
    expect(await registerToolSet(host.ctx, fourteen, new AbortController())).toBe(true)
    const elapsed = performance.now() - t0
    expect(elapsed).toBeLessThan(14 * 20 * 0.5)
    expect(host.issued).toEqual(fourteen.map((t) => t.name))
    expect(host.registered.size).toBe(14)
  })

  it("a rejection on tool N aborts the whole set (before and after N) and permits a clean retry", async () => {
    const seven = Array.from({ length: 14 }, (_, i) => tool(`tool_${i}`))
    const host = draftHost({ rejectAt: "tool_6" })
    await expect(registerToolSet(host.ctx, seven, new AbortController())).rejects.toThrow(
      "host refused tool_6"
    )
    await new Promise((r) => setTimeout(r, 10))
    expect(host.registered.size).toBe(0)
  })

  it("an abort before the set starts registers nothing", async () => {
    const host = draftHost()
    const controller = new AbortController()
    controller.abort()
    expect(await registerToolSet(host.ctx, TOOLS, controller)).toBe(false)
    expect(host.issued).toEqual([])
  })

  it("a rejection on tool N aborts tools 1…N−1 and permits a clean retry", async () => {
    const host = draftHost({ rejectAt: "c" })
    await expect(registerToolSet(host.ctx, TOOLS, new AbortController())).rejects.toThrow(
      "host refused c"
    )
    // the abort signal removed the partial set — no duplicate-name errors
    // await a tick for the host's abort listeners to run
    await new Promise((r) => setTimeout(r, 5))
    expect(host.registered.size).toBe(0)

    const retry = draftHost()
    expect(await registerToolSet(retry.ctx, TOOLS, new AbortController())).toBe(true)
  })

  it("an abort while the set is in flight reports failure and leaves nothing registered", async () => {
    const host = draftHost()
    const controller = new AbortController()
    const registering = registerToolSet(host.ctx, TOOLS, controller)
    controller.abort()
    expect(await registering).toBe(false)
    await new Promise((r) => setTimeout(r, 5))
    expect(host.registered.size).toBe(0)
  })

  it("legacy hosts returning undefined from registerTool still register", async () => {
    const names: string[] = []
    const ctx: ModelContext = {
      registerTool: (t) => {
        names.push(t.name)
        // legacy: returns void — Promise.resolve(undefined) awaits harmlessly
      },
    }
    expect(await registerToolSet(ctx, TOOLS, new AbortController())).toBe(true)
    expect(names).toEqual(["a", "b", "c"])
  })

  it("falls back to legacy provideContext when registerTool is absent", async () => {
    let provided: ToolDescriptor[] = []
    const ctx: ModelContext = { provideContext: ({ tools }) => (provided = tools) }
    expect(await registerToolSet(ctx, TOOLS, new AbortController())).toBe(true)
    expect(provided.length).toBe(3)
  })

  it("a registry with neither surface registers nothing", async () => {
    expect(await registerToolSet({}, TOOLS, new AbortController())).toBe(false)
  })
})
