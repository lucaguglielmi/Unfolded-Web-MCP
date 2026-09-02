export {}
import { attachProfiler } from "webmcp-profiler"
import { createFakeHost } from "webmcp-profiler/testing"

const host = createFakeHost()          // document.modelContext, draft-shaped
const profiler = attachProfiler({ overlay: true })

document.modelContext!.registerTool({
  name: "hello",
  description: "says hello",
  inputSchema: { type: "object" },
  execute: async () => ({ content: [{ type: "text", text: "hello" }] }),
})
await host.call("hello", {})           // measured, in the panel
console.log(profiler.summary())
