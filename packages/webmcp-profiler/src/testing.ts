/**
 * A WebMCP host you can install anywhere: in a unit test, on an example
 * page, or through Playwright's addInitScript. Modeled on the current
 * draft (promise-returning registerTool with an abort signal, getTools,
 * a toolchange event) with a legacy provideContext-only shape available.
 *
 *   import { createFakeHost } from "webmcp-profiler/testing"
 *   const host = createFakeHost()
 *   document.modelContext.registerTool({ name: "hello", execute: async () => ({ content: [] }) })
 *   await host.call("hello", {})
 */

import type { ToolLike } from "./core/interceptor"

/** Where and how the fake host installs. */
export interface FakeHostOptions {
  /** where to install; default "document" (the draft) */
  location?: "document" | "navigator" | "window"
  /** the legacy provideContext-only shape instead of registerTool */
  legacy?: boolean
  /** resolve registrations on a later tick, as real hosts do; default true */
  async?: boolean
  /** install onto the global immediately; default true */
  install?: boolean
  /** also keep a plain { name: tool } object at this global name (e.g. "__mcpTools") */
  mirror?: string
  /** expose the FakeHost itself at this global name (the init script sets "__webmcpFakeHost") */
  expose?: string
}

/** One registration-surface call the host saw. */
export interface RegistrationRecord {
  method: "registerTool" | "provideContext" | "unregisterTool" | "clearContext"
  name?: string
  options?: unknown
}

/** A RegisteredTool as getTools() returns it. */
export interface RegisteredToolInfo {
  name: string
  description?: string
  inputSchema?: unknown
  origin: string
}

/** The fake host handle. */
export interface FakeHost {
  /** what the page sees at the chosen location */
  registry: Record<string, unknown>
  /** currently registered tools */
  readonly tools: ReadonlyMap<string, ToolLike>
  /** every registration-surface call, in order, with its options */
  registrations: RegistrationRecord[]
  /** call a tool the way a host does: awaited, with an options bag carrying a signal */
  call(name: string, input?: unknown, options?: { signal?: AbortSignal }): Promise<unknown>
  /** the descriptors, for input generation */
  descriptors(): ToolLike[]
  /** abort a registration's signal, i.e. unregister, as the draft does */
  unregister(name: string): void
  uninstall(): void
}

/**
 * Self-contained on purpose: its source is stringified into
 * FAKE_HOST_INIT_SCRIPT, so it must not reference anything outside itself.
 */
function installFakeHost(g: Record<string, unknown>, options: FakeHostOptions): FakeHost {
  const location = options.location ?? "document"
  const isAsync = options.async !== false
  const tools = new Map<string, ToolLike>()
  const signals = new Map<string, AbortSignal>()
  const registrations: RegistrationRecord[] = []
  const listeners = new Map<string, Set<() => void>>()
  const origin = (g.location as { origin?: string } | undefined)?.origin ?? "null"

  const mirror = (): void => {
    if (!options.mirror) return
    g[options.mirror] = Object.fromEntries(tools)
  }
  const emit = (type: string): void => {
    mirror()
    for (const fn of listeners.get(type) ?? []) fn()
  }
  const later = <T>(value: T): Promise<T> =>
    isAsync ? new Promise((resolve) => setTimeout(() => resolve(value), 2)) : Promise.resolve(value)
  const remove = (name: string): void => {
    if (!tools.has(name)) return
    tools.delete(name)
    signals.delete(name)
    emit("toolchange")
  }
  const add = (tool: ToolLike, signal?: AbortSignal): void => {
    tools.set(tool.name, tool)
    if (signal) {
      // a re-registration replaces the old one: only the newest signal's
      // abort unregisters, as a host that replaced the registration would
      signals.set(tool.name, signal)
      signal.addEventListener("abort", () => {
        if (signals.get(tool.name) === signal) remove(tool.name)
      }, { once: true })
    } else signals.delete(tool.name)
    emit("toolchange")
  }

  const registry: Record<string, unknown> = {
    addEventListener: (type: string, fn: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(fn)
    },
    removeEventListener: (type: string, fn: () => void) => listeners.get(type)?.delete(fn),
  }
  if (options.legacy) {
    registry.provideContext = (context: { tools?: ToolLike[] }) => {
      registrations.push({ method: "provideContext" })
      tools.clear()
      for (const tool of context?.tools ?? []) tools.set(tool.name, tool)
      emit("toolchange")
    }
    registry.clearContext = () => {
      registrations.push({ method: "clearContext" })
      tools.clear()
      emit("toolchange")
    }
  } else {
    registry.registerTool = (tool: ToolLike, opts?: { signal?: AbortSignal }) => {
      registrations.push({ method: "registerTool", name: tool?.name, options: opts })
      if (!tool || typeof tool.name !== "string") return Promise.reject(new TypeError("registerTool: a tool needs a name"))
      if (opts?.signal?.aborted) return later(undefined)
      return later(undefined).then(() => {
        if (opts?.signal?.aborted) return
        add(tool, opts?.signal)
      })
    }
    registry.unregisterTool = (name: string) => {
      registrations.push({ method: "unregisterTool", name })
      remove(name)
      return later(undefined)
    }
    registry.getTools = () =>
      later(
        [...tools.values()].map(
          (t): RegisteredToolInfo => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, origin })
        )
      )
    registry.executeTool = (info: { name: string }, input: unknown, opts?: { signal?: AbortSignal }) =>
      host.call(info.name, input, opts).then((r) => JSON.stringify(r))
  }

  const target =
    location === "document" ? (g.document as Record<string, unknown>) : location === "navigator" ? (g.navigator as Record<string, unknown>) : g
  const previous = target?.modelContext

  const host: FakeHost = {
    registry,
    tools,
    registrations,
    call: async (name, input = {}, opts = {}) => {
      const tool = tools.get(name)
      if (!tool) throw new Error(`fake host: no tool named ${name}`)
      const signal = opts.signal ?? new AbortController().signal
      return tool.execute(input, { signal })
    },
    descriptors: () => [...tools.values()],
    unregister: (name) => remove(name),
    uninstall: () => {
      if (target) {
        if (previous === undefined) delete target.modelContext
        else target.modelContext = previous
      }
      if (options.mirror) delete g[options.mirror]
      if (options.expose) delete g[options.expose]
    },
  }
  if (options.install !== false && target) target.modelContext = registry
  if (options.expose) g[options.expose] = host
  mirror()
  return host
}

/** Install a fake WebMCP host and get a handle to drive it. */
export function createFakeHost(options: FakeHostOptions = {}): FakeHost {
  return installFakeHost(globalThis as unknown as Record<string, unknown>, options)
}

/**
 * The same host as one script string for Playwright's addInitScript: it
 * installs on document.modelContext, exposes the handle as
 * window.__webmcpFakeHost, and mirrors the tools to window.__mcpTools.
 */
export const FAKE_HOST_INIT_SCRIPT: string = `(${installFakeHost.toString()})(globalThis, { expose: "__webmcpFakeHost", mirror: "__mcpTools" })`

/** Build the init script with other options. */
export function fakeHostInitScript(options: FakeHostOptions = {}): string {
  return `(${installFakeHost.toString()})(globalThis, ${JSON.stringify({ expose: "__webmcpFakeHost", mirror: "__mcpTools", ...options })})`
}
