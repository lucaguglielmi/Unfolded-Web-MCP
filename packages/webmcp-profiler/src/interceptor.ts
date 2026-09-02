/**
 * webmcp-profiler · interceptor — how spans come to exist.
 *
 * Watches the places WebMCP hosts inject their registry (document /
 * navigator / window `.modelContext`) and patches `registerTool` /
 * `provideContext` so every tool a site registers gets an instrumented
 * `execute`. Instrumentation MUTATES the tool object in place: the host,
 * the site's own references, and console hooks all share the one object,
 * so every caller is measured no matter which handle they hold.
 *
 * Hosts inject late (agent browsers may attach modelContext minutes in),
 * so the watch polls — faster than any site's own registration poll needs
 * to be, which is what makes wrap-before-register the overwhelmingly
 * common order. A registry that was populated before the profiler loaded
 * can't be reached through the host (there is no enumeration API in the
 * proposal); `instrumentMap` retrofits site-exposed registries like
 * window.__unfoldedTools for that case.
 */

import type { Collector, Span } from "./collector"

/**
 * structural minimum — the profiler must not depend on any app's types.
 * `execute` is typed by its first argument only; whatever else a host
 * passes (the draft's options bag carrying its abort signal) is forwarded
 * by the wrapper untouched.
 */
export interface ToolLike {
  name: string
  execute: (input: unknown) => unknown | Promise<unknown>
}

interface ContentItem {
  type?: string
  data?: string
  text?: string
}

const WRAPPED = Symbol("webmcp-profiler-wrapped")
const POLL_MS = 250

const jsonBytes = (value: unknown): number => {
  try {
    return value === undefined ? 0 : JSON.stringify(value).length
  } catch {
    return 0
  }
}

function summarizeResult(result: unknown): {
  resultBytes: number
  contentTypes: Record<string, number>
  imageBytes: number
  isError: boolean
} {
  const resultBytes = jsonBytes(result)
  const contentTypes: Record<string, number> = {}
  let imageBytes = 0
  let isError = false
  if (result && typeof result === "object") {
    isError = (result as { isError?: boolean }).isError === true
    const content = (result as { content?: ContentItem[] }).content
    if (Array.isArray(content)) {
      for (const item of content) {
        const type = item?.type ?? "unknown"
        contentTypes[type] = (contentTypes[type] ?? 0) + 1
        if (type === "image" && typeof item.data === "string") imageBytes += item.data.length
      }
    }
  }
  return { resultBytes, contentTypes, imageBytes, isError }
}

export function instrumentTool(
  tool: ToolLike,
  collector: Collector,
  originals: Map<ToolLike, ToolLike["execute"]>
): void {
  if (!tool || typeof tool.execute !== "function") return
  const execute = tool.execute as ((...args: unknown[]) => unknown) & { [WRAPPED]?: true }
  if (execute[WRAPPED]) return

  originals.set(tool, execute)
  collector.toolRegistered(tool.name)

  // every argument goes through — the host's options bag (its abort
  // signal) must reach the tool; only the input is weighed for the span
  const wrapped = async (...args: unknown[]) => {
    const [input] = args
    const invokedAt = performance.now()
    try {
      const result = await execute.apply(tool, args)
      const settledAt = performance.now()
      collector.record({
        tool: tool.name,
        invokedAt,
        settledAt,
        wallMs: settledAt - invokedAt,
        blockingMs: 0,
        inputBytes: jsonBytes(input),
        ...summarizeResult(result),
        estTokens: Math.ceil(jsonBytes(result) / 4),
        error: null,
        synthetic: false,
      } as Omit<Span, "seq" | "gapSincePrevCallMs">)
      return result
    } catch (error) {
      const settledAt = performance.now()
      collector.record({
        tool: tool.name,
        invokedAt,
        settledAt,
        wallMs: settledAt - invokedAt,
        blockingMs: 0,
        inputBytes: jsonBytes(input),
        resultBytes: 0,
        contentTypes: {},
        imageBytes: 0,
        estTokens: 0,
        isError: true,
        error: error instanceof Error ? error.message : String(error),
        synthetic: false,
      })
      throw error
    }
  }
  ;(wrapped as typeof wrapped & { [WRAPPED]?: true })[WRAPPED] = true
  tool.execute = wrapped
}

/** retrofit a site-exposed registry ({name: tool}) — the late-load path */
export function instrumentMap(
  tools: Record<string, ToolLike>,
  collector: Collector,
  originals: Map<ToolLike, ToolLike["execute"]>
): number {
  let count = 0
  for (const tool of Object.values(tools ?? {})) {
    instrumentTool(tool, collector, originals)
    count++
  }
  return count
}

interface RegistryLike {
  registerTool?: (tool: ToolLike, ...rest: unknown[]) => unknown
  provideContext?: (context: { tools: ToolLike[] }, ...rest: unknown[]) => unknown
}

export interface Interception {
  stop: () => void
  /** restore every wrapped execute — used by profiler.detach() */
  unwrapAll: () => void
  /** put every registry's own registerTool / provideContext back */
  unpatchAll: () => void
  originals: Map<ToolLike, ToolLike["execute"]>
}

export function startInterception(collector: Collector): Interception {
  const originals = new Map<ToolLike, ToolLike["execute"]>()
  // the registries patched so far, each with the methods it had before —
  // detach puts them back, and clearing the map is what lets a later
  // attach patch the same host again instead of wrapping a stale wrapper
  const patched = new Map<RegistryLike, Pick<RegistryLike, "registerTool" | "provideContext">>()

  const patchRegistry = (registry: RegistryLike, where: string): void => {
    if (!registry || typeof registry !== "object" || patched.has(registry)) return
    const { registerTool, provideContext } = registry
    patched.set(registry, { registerTool, provideContext })
    collector.hostFound(where)

    // extra arguments pass straight through: the site's `{ signal }` is
    // how it unregisters (and re-registers) its tools on a draft host
    if (registerTool) {
      registry.registerTool = (tool, ...rest) => {
        instrumentTool(tool, collector, originals)
        return registerTool.call(registry, tool, ...rest)
      }
    }
    if (provideContext) {
      registry.provideContext = (context, ...rest) => {
        for (const tool of context?.tools ?? []) instrumentTool(tool, collector, originals)
        return provideContext.call(registry, context, ...rest)
      }
    }
  }

  const sweep = (): void => {
    const spots: [unknown, string][] = [
      [(document as Document & { modelContext?: RegistryLike }).modelContext, "document"],
      [(navigator as Navigator & { modelContext?: RegistryLike }).modelContext, "navigator"],
      [(window as Window & { modelContext?: RegistryLike }).modelContext, "window"],
    ]
    for (const [registry, where] of spots) {
      if (registry) patchRegistry(registry as RegistryLike, where)
    }
  }

  sweep()
  const timer = window.setInterval(sweep, POLL_MS)

  return {
    stop: () => window.clearInterval(timer),
    unwrapAll: () => {
      for (const [tool, execute] of originals) tool.execute = execute
      originals.clear()
    },
    unpatchAll: () => {
      for (const [registry, { registerTool, provideContext }] of patched) {
        if (registerTool) registry.registerTool = registerTool
        if (provideContext) registry.provideContext = provideContext
      }
      patched.clear()
    },
    originals,
  }
}
