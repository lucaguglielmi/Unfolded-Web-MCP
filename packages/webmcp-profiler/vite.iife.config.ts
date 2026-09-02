import { readFileSync } from "node:fs"
import { defineConfig } from "vite"

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string }

// Single-file classic-script build for `<script src=…>` and bookmarklet
// use: exposes window.WebMCPProfiler and runs the ?perf= gate on load, so
// dropping the tag onto any WebMCP page is the whole integration.
export default defineConfig({
  define: { __WEBMCP_PROFILER_VERSION__: JSON.stringify(pkg.version) },
  build: {
    lib: {
      entry: "src/iife.ts",
      formats: ["iife"],
      name: "WebMCPProfiler",
      fileName: () => "webmcp-profiler.iife.js",
    },
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: true,
    target: "es2022",
    minify: "esbuild",
  },
})
