import { defineConfig } from "vite"

// Single-file classic-script build for `<script src=…>` and bookmarklet
// use: exposes window.WebMCPProfiler and runs the ?perf= gate on load, so
// dropping the tag onto any WebMCP page is the whole integration. Dynamic
// imports are inlined — one file, no chunk loading.
export default defineConfig({
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
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
})
