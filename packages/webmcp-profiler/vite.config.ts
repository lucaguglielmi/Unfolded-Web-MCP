import { defineConfig } from "vite"

// ESM build: index (attachProfiler + types) and attach (the ?perf= boot
// gate) as separate entries so apps can import just the gate. The overlay
// stays a lazy chunk — consumers who never open the panel never load it.
export default defineConfig({
  build: {
    lib: {
      entry: { index: "src/index.ts", attach: "src/attach.ts" },
      formats: ["es"],
    },
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    target: "es2022",
  },
})
