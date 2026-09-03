// The demo's script lives in its own file so it runs under a strict
// Content Security Policy (script-src 'self'), like the hosted copy.
import { createFakeHost } from "../../dist/testing.js"

const log = (line) => (document.getElementById("log").textContent += line + "\n")
const host = createFakeHost({ async: false })
const profiler = WebMCPProfiler.attach({ overlay: true, relay: false })

const png = "iVBORw0KGgo" + "A".repeat(4000)
await document.modelContext.registerTool({
  name: "describe_thing",
  description: "A fast read-only tool returning a sentence.",
  inputSchema: { type: "object", properties: { id: { type: "integer", minimum: 1, maximum: 9 } } },
  annotations: { readOnlyHint: true },
  execute: async ({ id }) => ({ content: [{ type: "text", text: `Thing ${id} is a mug, 95 mm tall, 350 ml.` }] }),
})
await document.modelContext.registerTool({
  name: "get_preview_image",
  description: "A slower tool returning a small image.",
  inputSchema: { type: "object" },
  annotations: { readOnlyHint: true },
  execute: async () => {
    const t0 = performance.now()
    while (performance.now() - t0 < 12) {} // simulate 12 ms of rendering work
    return { content: [{ type: "text", text: "preview" }, { type: "image", data: png, mimeType: "image/png" }] }
  },
})
await document.modelContext.registerTool(WebMCPProfiler.profilerTool(profiler))
log(profiler.status().message)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
document.getElementById("run").onclick = async () => {
  for (let i = 0; i < 10; i++) {
    const tool = i % 3 === 2 ? "get_preview_image" : "describe_thing"
    await host.call(tool, { id: 1 + (i % 9) })
    await sleep(100 + Math.random() * 600) // the "model thinking" gap
  }
  log(profiler.summary())
}
document.getElementById("summary").onclick = () => log(profiler.summary())
document.getElementById("report").onclick = () => console.log(profiler.report())
document.getElementById("bookmarklet").href =
  "javascript:" + encodeURIComponent(
    "(function(){var s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/webmcp-profiler@0.2/dist/webmcp-profiler.iife.js';s.onload=function(){WebMCPProfiler.attach({overlay:true})};document.head.appendChild(s)})()"
  )
document.getElementById("run").click()
