import type { ErrorPolicy } from "./collector"

/** Defaults for every configuration key; the gate, the docs, and attachProfiler read them from here. */
export const DEFAULTS = {
  buffer: 500,
  relay: true,
  overlay: false,
  globalName: "__webmcpPerf" as string | false,
  pollMs: 250,
  sample: 1,
  errorPolicy: "message" as ErrorPolicy,
  param: "perf",
  storageKey: "webmcp-perf:mode",
  announce: true as boolean | ((profiler: unknown) => void),
}
