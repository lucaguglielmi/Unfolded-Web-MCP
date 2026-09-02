export {}
import { attachProfiler } from "webmcp-profiler"

const profiler = attachProfiler({
  buffer: 500,      // spans kept in memory
  relay: true,      // mirror spans to same-origin tabs
  overlay: false,   // open the panel now
  sample: 1,        // measure every call
  onSpan: (span) => console.debug(span.tool, span.wallMs),
})
console.log(profiler.status().message)
