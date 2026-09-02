export {}
import { attachProfiler } from "webmcp-profiler"
import { profilerTool } from "webmcp-profiler/tool"

const profiler = attachProfiler()
document.modelContext!.registerTool(profilerTool(profiler))   // name: get_perf_report
