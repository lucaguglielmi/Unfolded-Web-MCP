#!/usr/bin/env node
/**
 * webmcp-profiler CLI.
 *
 *   webmcp-profiler bench <url> [--runs 40] [--seed 1] [--cases file.json]
 *       [--allow-mutating a,b] [--budget file.json] [--json out.json]
 *       [--overhead] [--param perf] [--chromium /path/to/chromium]
 *   webmcp-profiler compare <base.json> <head.json> [--thresholds file.json]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs"

const args = process.argv.slice(2)
const command = args.shift()

const flags = {}
const positional = []
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a.startsWith("--")) {
    const key = a.slice(2)
    const next = args[i + 1]
    if (next === undefined || next.startsWith("--")) flags[key] = true
    else {
      flags[key] = next
      i++
    }
  } else positional.push(a)
}

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"))

const usage = () => {
  console.error(
    [
      "usage:",
      "  webmcp-profiler bench <url> [--runs 40] [--seed 1] [--cases file.json] [--allow-mutating a,b]",
      "                        [--budget file.json] [--json out.json] [--overhead] [--param perf] [--chromium path]",
      "  webmcp-profiler compare <base.json> <head.json> [--thresholds file.json]",
    ].join("\n")
  )
  process.exit(2)
}

if (command === "bench") {
  const url = positional[0]
  if (!url) usage()
  const { runBench, formatBenchTable } = await import("../dist/bench/run.js")
  const chromium =
    flags.chromium ?? process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined)
  const result = await runBench({
    url,
    runs: flags.runs ? Number(flags.runs) : undefined,
    seed: flags.seed ? Number(flags.seed) : undefined,
    param: flags.param,
    allowMutating: flags["allow-mutating"] ? String(flags["allow-mutating"]).split(",") : undefined,
    cases: flags.cases ? readJson(flags.cases) : undefined,
    budgets: flags.budget ? readJson(flags.budget) : undefined,
    executablePath: chromium,
    overhead: flags.overhead === true,
    log: (line) => console.error(line),
  })
  console.log(formatBenchTable(result))
  if (flags.json) {
    writeFileSync(flags.json, JSON.stringify({ rows: result.rows, boot: result.boot, report: result.report }, null, 2))
    console.error(`wrote ${flags.json}`)
  }
  process.exit(result.ok ? 0 : 1)
} else if (command === "compare") {
  const [base, head] = positional
  if (!base || !head) usage()
  const { compare, formatDiff } = await import("../dist/index.js")
  const unwrap = (doc) => (doc && doc.report && doc.report.format ? doc.report : doc)
  const diff = compare(unwrap(readJson(base)), unwrap(readJson(head)), flags.thresholds ? readJson(flags.thresholds) : undefined)
  console.log(formatDiff(diff))
  process.exit(diff.verdict === "fail" ? 1 : 0)
} else usage()
