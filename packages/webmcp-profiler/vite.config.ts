import { readFileSync } from "node:fs"
import { defineConfig } from "vite"

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string }

// ESM build, one entry per public subpath. The core (src/core) lands in a
// shared chunk named after its directory; the overlay stays a lazy chunk
// so consumers who never open the panel never load it.
export default defineConfig({
  define: { __WEBMCP_PROFILER_VERSION__: JSON.stringify(pkg.version) },
  build: {
    lib: {
      entry: {
        index: "src/index.ts",
        attach: "src/attach.ts",
        "attach-lazy": "src/attach-lazy.ts",
        tool: "src/tool.ts",
        testing: "src/testing.ts",
        docs: "src/docs.ts",
      },
      formats: ["es"],
    },
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    target: "es2022",
    minify: "esbuild",
    rolldownOptions: {
      output: {
        chunkFileNames: "[name]-[hash].js",
        advancedChunks: {
          groups: [
            { name: "docs", test: /src\/core\/docs\.ts$/, minSize: 0, minShareCount: 1 },
            { name: "core", test: /src\/core\/(?!docs\.ts)/, minSize: 0, minShareCount: 1 },
          ],
        },
      },
    },
  },
})
