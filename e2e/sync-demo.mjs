// Copies the package's example page and the two built files it loads into
// public/webmcp-profiler/demo/, so the site hosts the zero-install demo the
// package README points at (docs/webmcp-profiler-0.2-spec.md §20.2).
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"

const pkg = new URL("../packages/webmcp-profiler/", import.meta.url)
const out = new URL("../public/webmcp-profiler/demo/", import.meta.url)
mkdirSync(out, { recursive: true })
copyFileSync(new URL("dist/webmcp-profiler.iife.js", pkg), new URL("webmcp-profiler.iife.js", out))
copyFileSync(new URL("dist/testing.js", pkg), new URL("testing.js", out))
writeFileSync(
  new URL("demo.js", out),
  readFileSync(new URL("examples/vanilla/demo.js", pkg), "utf8")
    .replaceAll("../../dist/webmcp-profiler.iife.js", "./webmcp-profiler.iife.js")
    .replaceAll("../../dist/testing.js", "./testing.js")
)
const html = readFileSync(new URL("examples/vanilla/index.html", pkg), "utf8")
  .replaceAll("../../dist/webmcp-profiler.iife.js", "./webmcp-profiler.iife.js")
  .replaceAll("../../dist/testing.js", "./testing.js")
writeFileSync(new URL("index.html", out), html)
console.log("demo: synced to public/webmcp-profiler/demo/")
