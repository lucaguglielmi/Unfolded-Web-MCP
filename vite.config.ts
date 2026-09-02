import fs from "node:fs"
import path from "node:path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

/**
 * `.env.example` is committed and is the build's DEFAULT for every VITE_
 * variable the environment (or a git-ignored local .env, which Vite loads
 * itself and which wins) doesn't set — so a clean checkout and CI build
 * with the public values without anyone copying a file first. Nothing in
 * it is secret: VITE_ values are inlined into the client bundle.
 */
function applyEnvExampleDefaults(): void {
  const file = path.resolve(import.meta.dirname, ".env.example")
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^\s*(VITE_[A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2]
  }
}
applyEnvExampleDefaults()

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // the profiler lives in its own publishable workspace package; the
      // app consumes its SOURCE (order matters: before the "@" catch-all)
      "@/profiler": path.resolve(import.meta.dirname, "./packages/webmcp-profiler/src"),
      "@": path.resolve(import.meta.dirname, "./src"),
      // jsPDF optional deps for features we never call — see the stub's doc
      html2canvas: path.resolve(import.meta.dirname, "./src/lib/export/jspdf-optional-stub.ts"),
      dompurify: path.resolve(import.meta.dirname, "./src/lib/export/jspdf-optional-stub.ts"),
      canvg: path.resolve(import.meta.dirname, "./src/lib/export/jspdf-optional-stub.ts"),
    },
  },
})
