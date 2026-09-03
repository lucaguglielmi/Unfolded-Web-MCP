/**
 * Entry for the single-file classic-script build. Loading the script is
 * the integration: it exposes the API as window.WebMCPProfiler and runs
 * the ?perf= gate immediately, so a page (or bookmarklet) that adds
 *
 *   <script src="webmcp-profiler.iife.js"></script>
 *
 * profiles as soon as anyone opens it with ?perf=1.
 */

export { attachProfiler, compare, REPORT_FORMAT, PACKAGE_VERSION } from "./index"
export type { Profiler, ProfilerConfig, GateConfig } from "./index"
export { maybeAttachProfiler, PERF_STORAGE_KEY } from "./attach"
export { profilerTool } from "./tool"

import { attachProfiler } from "./index"
import { maybeAttachProfiler } from "./attach"

/** Bookmarklet-friendly alias: attach with the overlay open unless told otherwise. */
export const attach = (config: Parameters<typeof attachProfiler>[0] = {}) => attachProfiler({ overlay: true, ...config })

maybeAttachProfiler()
