import path from "node:path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      // jsPDF optional deps for features we never call — see the stub's doc
      html2canvas: path.resolve(import.meta.dirname, "./src/lib/export/jspdf-optional-stub.ts"),
      dompurify: path.resolve(import.meta.dirname, "./src/lib/export/jspdf-optional-stub.ts"),
      canvg: path.resolve(import.meta.dirname, "./src/lib/export/jspdf-optional-stub.ts"),
    },
  },
})
