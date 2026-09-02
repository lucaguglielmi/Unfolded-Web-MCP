export {}
import { attachProfiler } from "webmcp-profiler"

const profiler = attachProfiler({ globalName: false, relay: false, sample: 0.1 })
profiler.onSpan((span) => {
  const { tool, wallMs, resultBytes, estTokens, gapSincePrevCallMs, isError } = span
  navigator.sendBeacon("/perf", JSON.stringify({ tool, wallMs, resultBytes, estTokens, gapSincePrevCallMs, isError }))
})
