/** Cross-module state that is not part of the public API: the report tool's name per profiler. */
import type { Profiler } from "../index"

/** The name the site registered the report tool under, per profiler. */
export const reportToolNames = new WeakMap<Profiler, string>()
