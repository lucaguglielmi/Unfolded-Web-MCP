/**
 * How spans come to exist. Watches the places WebMCP hosts expose their
 * registry (`document.modelContext` per the draft; `navigator` and
 * `window` for legacy hosts), patches the registration methods so every
 * tool a site registers gets an instrumented `execute`, and keeps the
 * ledger's registry in step with unregistration. Instrumentation
 * mutates the tool object in place, so the host, the site's own
 * references, and console hooks all share one measured function.
 */

import { utf8Length, type Collector, type ErrorPolicy, type RawSpan } from "./collector"

/**
 * The structural minimum of a tool descriptor. `execute` is declared
 * with method syntax on purpose: TypeScript checks methods bivariantly,
 * so a descriptor with a narrower input type is accepted.
 */
export interface ToolLike {
  name: string
  title?: string
  description?: string
  inputSchema?: unknown
  annotations?: unknown
  execute(input: unknown, ...rest: unknown[]): unknown
}

/** Marks a descriptor the profiler must list but never measure (its own report tool). */
export const PROFILER_INTERNAL: unique symbol = Symbol.for("webmcp-profiler.internal")

interface ContentItem {
  type?: string
  data?: string
  text?: string
  mimeType?: string
}

const WRAPPED = Symbol.for("webmcp-profiler.wrapped")
const ERROR_MESSAGE_CAP = 200

/** Tuning shared by every wrapped tool of one profiler. */
export interface WrapOptions {
  collector: Collector
  originals: Map<ToolLike, ToolLike["execute"]>
  /** fraction of calls measured; the rest pass through untouched */
  sample: number
  errorPolicy: ErrorPolicy
}

const safeStringify = (value: unknown): string | null => {
  if (value === undefined) return ""
  try {
    const json = JSON.stringify(value)
    return json === undefined ? "" : json
  } catch {
    return null
  }
}

/** UTF-8 bytes of the descriptor fields a host ships to the model in every conversation. */
export function schemaBytesOf(tool: ToolLike): number {
  const json = safeStringify({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
  })
  return json === null ? 0 : utf8Length(json)
}

const describeError = (error: unknown, policy: ErrorPolicy): string | null => {
  if (policy === "none") return null
  if (policy === "name") return error instanceof Error ? error.name : typeof error
  const message = error instanceof Error ? error.message : String(error)
  return message.length > ERROR_MESSAGE_CAP ? `${message.slice(0, ERROR_MESSAGE_CAP)}…` : message
}

function summarize(result: unknown, inputBytes: number, opts: WrapOptions): Omit<RawSpan, "tool" | "invokedAt" | "settledAt" | "wallMs" | "blockingMs" | "isError" | "error"> & { isError: boolean } {
  const estimator = opts.collector.tokenEstimator
  const json = safeStringify(result)
  const resultBytes = json === null ? 0 : utf8Length(json)
  const contentTypes: Record<string, number> = {}
  let imageBytes = 0
  let estImageTokens = 0
  let isError = false
  if (result && typeof result === "object") {
    isError = (result as { isError?: boolean }).isError === true
    const content = (result as { content?: ContentItem[] }).content
    if (Array.isArray(content)) {
      for (const item of content) {
        const type = item?.type ?? "unknown"
        contentTypes[type] = (contentTypes[type] ?? 0) + 1
        if (type === "image" && typeof item.data === "string") {
          imageBytes += item.data.length
          estImageTokens += estimator({ kind: "image", bytes: item.data.length, mimeType: item.mimeType })
        }
      }
    }
  }
  const estInputTokens = estimator({ kind: "input", bytes: inputBytes })
  const estTextTokens = estimator({ kind: "text", bytes: Math.max(0, resultBytes - imageBytes) })
  return {
    inputBytes,
    resultBytes,
    contentTypes,
    imageBytes,
    estInputTokens,
    estTextTokens,
    estImageTokens,
    estTokens: estInputTokens + estTextTokens + estImageTokens,
    isError,
    serializable: json !== null,
  }
}

const isInternal = (tool: ToolLike): boolean => (tool as { [PROFILER_INTERNAL]?: true })[PROFILER_INTERNAL] === true

/** A descriptor the host could accept: a named object with an execute function. */
export const isToolLike = (tool: unknown): tool is ToolLike =>
  !!tool && typeof tool === "object" && typeof (tool as ToolLike).name === "string" && typeof (tool as ToolLike).execute === "function"

/** Open (or re-open) the ledger record for a tool the host holds. */
export function ledgerRegister(tool: ToolLike, collector: Collector): void {
  collector.toolRegistered(tool.name, schemaBytesOf(tool), isInternal(tool))
}

/**
 * Wrap one tool's execute in place; idempotent; internal tools are never
 * wrapped. With `register` (the default) the ledger record opens at once,
 * which is right for retrofits and synchronous hosts; the registerTool
 * patch passes false and opens the record when the host accepts.
 */
export function instrumentTool(tool: ToolLike, opts: WrapOptions, register = true): void {
  if (!isToolLike(tool)) return
  const { collector, originals } = opts
  if (isInternal(tool)) {
    if (register) ledgerRegister(tool, collector)
    return
  }
  const execute = tool.execute as ((...args: unknown[]) => unknown) & { [WRAPPED]?: true }
  // a re-registration (a host swap, a StrictMode remount) re-opens the
  // ledger record even though the function is already wrapped
  if (register) ledgerRegister(tool, collector)
  if (execute[WRAPPED]) return

  originals.set(tool, execute)

  // every argument goes through: the host's options bag (its abort
  // signal) must reach the tool; only the input is weighed for the span
  const wrapped = async function (this: unknown, ...args: unknown[]) {
    if (opts.sample < 1 && Math.random() >= opts.sample) {
      collector.recordUnsampled()
      return execute.apply(tool, args)
    }
    const [input] = args
    const inputJson = safeStringify(input)
    const inputBytes = inputJson === null ? 0 : utf8Length(inputJson)
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
        error: null,
        ...summarize(result, inputBytes, opts),
      })
      return result
    } catch (error) {
      const settledAt = performance.now()
      collector.record({
        tool: tool.name,
        invokedAt,
        settledAt,
        wallMs: settledAt - invokedAt,
        blockingMs: 0,
        inputBytes,
        resultBytes: 0,
        contentTypes: {},
        imageBytes: 0,
        estInputTokens: collector.tokenEstimator({ kind: "input", bytes: inputBytes }),
        estTextTokens: 0,
        estImageTokens: 0,
        estTokens: collector.tokenEstimator({ kind: "input", bytes: inputBytes }),
        isError: true,
        error: describeError(error, opts.errorPolicy),
        serializable: true,
      })
      throw error
    }
  }
  ;(wrapped as typeof wrapped & { [WRAPPED]?: true })[WRAPPED] = true
  for (const key of ["name", "length"] as const) {
    try {
      Object.defineProperty(wrapped, key, { value: execute[key], configurable: true })
    } catch {
      /* non-configurable on an exotic host object: cosmetic only */
    }
  }
  tool.execute = wrapped
}

/** Retrofit a site-exposed `{ name: tool }` registry (the late-load path). Returns how many were wrapped. */
export function instrumentMap(tools: Record<string, ToolLike>, opts: WrapOptions): number {
  let count = 0
  for (const tool of Object.values(tools ?? {})) {
    instrumentTool(tool, opts)
    count++
  }
  return count
}

interface RegistryLike {
  registerTool?: (tool: ToolLike, ...rest: unknown[]) => unknown
  unregisterTool?: (name: string, ...rest: unknown[]) => unknown
  provideContext?: (context: { tools: ToolLike[] }, ...rest: unknown[]) => unknown
  clearContext?: (...rest: unknown[]) => unknown
  getTools?: (...rest: unknown[]) => unknown
  addEventListener?: (type: string, listener: () => void) => void
  removeEventListener?: (type: string, listener: () => void) => void
}

type Patched = Pick<RegistryLike, "registerTool" | "unregisterTool" | "provideContext" | "clearContext"> & {
  toolchange?: () => void
}

/** Handle on a running interception. */
export interface Interception {
  stop: () => void
  /** restore every wrapped execute */
  unwrapAll: () => void
  /** put every registry's own methods back */
  unpatchAll: () => void
  originals: Map<ToolLike, ToolLike["execute"]>
  /** where the first registry was found, or null while still looking */
  hostLocation: () => string | null
  /** true while the sweep timer is running */
  polling: () => boolean
}

/** Tuning for startInterception. */
export interface InterceptionOptions {
  pollMs?: number
}

const isNativeObject = (value: object): boolean => {
  const proto = Object.getPrototypeOf(value)
  return proto !== null && proto !== Object.prototype
}

const sameOriginNames = (list: unknown): string[] => {
  if (!Array.isArray(list)) return []
  const here = typeof location === "undefined" ? null : location.origin
  return list
    .filter((t): t is { name: string; origin?: string } => !!t && typeof (t as { name?: unknown }).name === "string")
    .filter((t) => !t.origin || t.origin === here)
    .map((t) => t.name)
}

/** Watch for registries, patch them, and keep the ledger in step with (un)registration. */
export function startInterception(wrap: WrapOptions, options: InterceptionOptions = {}): Interception {
  const { collector, originals } = wrap
  const pollMs = options.pollMs ?? 250
  const patched = new Map<RegistryLike, Patched>()
  // the newest registration signal per tool name: an older signal's abort
  // (a superseded registration set) must not unregister a re-registered tool
  const latestSignal = new Map<string, AbortSignal>()
  let location: string | null = null
  let timer: number | null = null

  const reconcile = (registry: RegistryLike): void => {
    if (typeof registry.getTools !== "function") return
    const issuedAt = performance.now()
    try {
      Promise.resolve(registry.getTools()).then(
        (list) => collector.reconcileRegistered(sameOriginNames(list), issuedAt),
        () => undefined
      )
    } catch {
      /* a host whose getTools throws is simply not reconciled */
    }
  }

  const patchRegistry = (registry: RegistryLike, where: string): void => {
    if (!registry || typeof registry !== "object" || patched.has(registry)) return
    const { registerTool, unregisterTool, provideContext, clearContext } = registry
    const record: Patched = { registerTool, unregisterTool, provideContext, clearContext }
    patched.set(registry, record)
    if (location === null) location = where
    collector.hostFound(where)

    // extra arguments pass straight through: the site's `{ signal, exposedTo }`
    // reach the host untouched; the signal also tells us about unregistration
    if (registerTool) {
      registry.registerTool = (tool, ...rest) => {
        const valid = isToolLike(tool)
        // wrap now so a call that lands before the host's promise settles is
        // still measured; the ledger record opens only when the host accepts
        if (valid) instrumentTool(tool, wrap, false)
        const signal = (rest[0] as { signal?: AbortSignal } | undefined)?.signal
        const result = registerTool.call(registry, tool, ...rest)
        if (valid && !signal?.aborted) {
          const accept = (): void => {
            if (signal?.aborted) return // dropped by the host while pending
            ledgerRegister(tool, collector)
            if (signal && typeof signal.addEventListener === "function") {
              latestSignal.set(tool.name, signal)
              signal.addEventListener(
                "abort",
                () => {
                  if (latestSignal.get(tool.name) === signal) collector.toolUnregistered(tool.name)
                },
                { once: true }
              )
            }
          }
          if (result && typeof (result as Promise<unknown>).then === "function") {
            ;(result as Promise<unknown>).then(accept, () => undefined)
          } else accept()
        }
        return result
      }
    }
    if (unregisterTool) {
      registry.unregisterTool = (name, ...rest) => {
        collector.toolUnregistered(name)
        return unregisterTool.call(registry, name, ...rest)
      }
    }
    if (provideContext) {
      // provideContext replaces the whole context: tools absent from the new
      // set leave the ledger, the new set is wrapped and registered at once
      registry.provideContext = (context, ...rest) => {
        const next = (context?.tools ?? []).filter(isToolLike)
        const names = new Set(next.map((t) => t.name))
        for (const name of [...collector.ledger.registeredTools]) if (!names.has(name)) collector.toolUnregistered(name)
        for (const tool of next) instrumentTool(tool, wrap)
        return provideContext.call(registry, context, ...rest)
      }
    }
    if (clearContext) {
      registry.clearContext = (...rest) => {
        for (const name of [...collector.ledger.registeredTools]) collector.toolUnregistered(name)
        return clearContext.call(registry, ...rest)
      }
    }
    if (typeof registry.addEventListener === "function") {
      record.toolchange = () => reconcile(registry)
      try {
        registry.addEventListener("toolchange", record.toolchange)
      } catch {
        record.toolchange = undefined
      }
    }
  }

  const sweep = (): boolean => {
    const spots: [unknown, string][] = [
      [typeof document === "undefined" ? undefined : (document as Document & { modelContext?: RegistryLike }).modelContext, "document"],
      [typeof navigator === "undefined" ? undefined : (navigator as Navigator & { modelContext?: RegistryLike }).modelContext, "navigator"],
      [typeof window === "undefined" ? undefined : (window as Window & { modelContext?: RegistryLike }).modelContext, "window"],
    ]
    let found = 0
    let nativeOnDocument = false
    for (const [registry, where] of spots) {
      if (registry && typeof registry === "object") {
        found++
        patchRegistry(registry as RegistryLike, where)
        if (where === "document" && isNativeObject(registry)) nativeOnDocument = true
      }
    }
    // a native implementation is present from page load and nothing later
    // replaces it; polyfills and extension hosts (plain objects) may still
    // arrive or be swapped for a new object, so the poll keeps going for
    // those however many locations are filled
    return nativeOnDocument
  }

  const stop = (): void => {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  if (!sweep()) {
    timer = setInterval(() => {
      if (sweep()) stop()
    }, pollMs) as unknown as number
  }

  return {
    stop,
    unwrapAll: () => {
      for (const [tool, execute] of originals) tool.execute = execute
      originals.clear()
    },
    unpatchAll: () => {
      for (const [registry, record] of patched) {
        if (record.registerTool) registry.registerTool = record.registerTool
        if (record.unregisterTool) registry.unregisterTool = record.unregisterTool
        if (record.provideContext) registry.provideContext = record.provideContext
        if (record.clearContext) registry.clearContext = record.clearContext
        if (record.toolchange && typeof registry.removeEventListener === "function") {
          try {
            registry.removeEventListener("toolchange", record.toolchange)
          } catch {
            /* nothing to remove */
          }
        }
      }
      patched.clear()
    },
    originals,
    hostLocation: () => location,
    polling: () => timer !== null,
  }
}
