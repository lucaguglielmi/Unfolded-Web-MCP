/**
 * The boot gate's decision logic, shared by the sync and lazy entry
 * points and free of any import of the core, so the lazy entry can keep
 * the core out of the main bundle.
 */

/** A profiling mode the gate persists. */
export type PerfMode = "1" | "overlay"

/** The localStorage key the gate persists the mode under, by default. */
export const PERF_STORAGE_KEY = "webmcp-perf:mode"

/** Options for the gate; extends the profiler configuration it forwards. */
export interface GateOptions {
  /** query parameter that arms the profiler */
  param?: string
  /** localStorage key that persists the mode */
  storageKey?: string
  /** the site's last word on whether the gate may open at all */
  allow?: () => boolean
}

const ON = new Set(["1", "on", "true"])
const OFF = new Set(["0", "off", "false"])

/** Read the URL and storage, persist as documented, and say which mode (if any) to open. */
export function resolveGate(options: GateOptions = {}): { mode: PerfMode | null; rejected: string | null } {
  if (typeof window === "undefined" || typeof location === "undefined") return { mode: null, rejected: null }
  const param = options.param ?? "perf"
  const key = options.storageKey ?? PERF_STORAGE_KEY
  let storage: Storage | null = null
  try {
    storage = window.localStorage
  } catch {
    storage = null
  }
  if (options.allow && !options.allow()) {
    try {
      storage?.removeItem(key)
    } catch {
      /* storage blocked */
    }
    return { mode: null, rejected: null }
  }
  let requested: string | null = null
  try {
    requested = new URLSearchParams(location.search).get(param)
  } catch {
    requested = null
  }
  let rejected: string | null = null
  try {
    if (requested !== null && requested !== "") {
      if (OFF.has(requested)) storage?.removeItem(key)
      else if (ON.has(requested)) storage?.setItem(key, "1")
      else if (requested === "overlay") storage?.setItem(key, "overlay")
      else rejected = requested
    }
    if (requested !== null && OFF.has(requested)) return { mode: null, rejected }
    const stored = storage?.getItem(key) ?? null
    const mode = stored === "overlay" ? "overlay" : stored === "1" ? "1" : null
    return { mode, rejected }
  } catch {
    return { mode: null, rejected }
  }
}
