/**
 * Entry for the single-file classic-script build. Loading the script is
 * the integration: it exposes the API as window.WebMCPProfiler and runs
 * the ?perf= gate immediately, so a page (or bookmarklet) that adds
 *
 *   <script src="webmcp-profiler.iife.js"></script>
 *
 * profiles as soon as anyone opens it with ?perf=1.
 */

export { attachProfiler } from "./index"
export type { Profiler, ProfilerConfig } from "./index"
export { maybeAttachProfiler, PERF_STORAGE_KEY } from "./attach"

import { maybeAttachProfiler } from "./attach"

maybeAttachProfiler()
