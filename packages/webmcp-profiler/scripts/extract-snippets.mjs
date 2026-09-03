#!/usr/bin/env node
// Pull every fenced ```ts block out of the README into src/__snippets__
// so the snippets test can type-check them against the package itself.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"

const root = new URL("../", import.meta.url)
const readme = readFileSync(new URL("README.md", root), "utf8")
const dir = new URL("src/__snippets__/", root)
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })
writeFileSync(
  new URL("globals.d.ts", dir),
  "interface Document { modelContext?: { registerTool(tool: unknown, options?: unknown): Promise<void> } }\n"
)
const blocks = [...readme.matchAll(/```ts\n([\s\S]*?)```/g)].map((m) => m[1])
blocks.forEach((body, i) => {
  // each snippet becomes its own module; package imports resolve through
  // the tsconfig paths in tsconfig.snippets.json
  writeFileSync(new URL(`snippet-${String(i + 1).padStart(2, "0")}.ts`, dir), `export {}\n${body}`)
})
console.log(`snippets: ${blocks.length} extracted to ${dir.pathname}`)
if (readdirSync(dir).length === 0) writeFileSync(new URL("none.ts", dir), "export {}\n")
