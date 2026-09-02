#!/usr/bin/env node
// Gzip size ceilings for the built artifacts (0.2 spec §16.5). Fails
// loudly with the numbers so a regression is visible in CI output.
import { readdirSync, readFileSync } from "node:fs"
import { gzipSync } from "node:zlib"
import { join } from "node:path"

const dist = new URL("../dist/", import.meta.url).pathname
const CEILINGS = [
  { match: /^core-.*\.js$/, limit: 6 * 1024, label: "core chunk" },
  { match: /^attach\.js$/, limit: 1 * 1024, label: "attach" },
  { match: /^overlay-.*\.js$/, limit: 4 * 1024, label: "overlay chunk" },
  { match: /^webmcp-profiler\.iife\.js$/, limit: 14 * 1024, label: "IIFE" },
]
let failed = false
const files = readdirSync(dist).filter((f) => f.endsWith(".js"))
for (const { match, limit, label } of CEILINGS) {
  const file = files.find((f) => match.test(f))
  if (!file) {
    console.error(`size: no file for ${label} (${match})`)
    failed = true
    continue
  }
  const gz = gzipSync(readFileSync(join(dist, file))).length
  const ok = gz <= limit
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(14)} ${file.padEnd(32)} ${(gz / 1024).toFixed(2)} KB gz (limit ${(limit / 1024).toFixed(1)} KB)`)
  if (!ok) failed = true
}
process.exit(failed ? 1 : 0)
