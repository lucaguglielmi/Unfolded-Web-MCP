/**
 * Timing probe: how long does each WebMCP tool's execute() actually take
 * in-page, called exactly the way a host calls it? Production bundle via
 * vite preview, real Chromium. Run with `npm run perf` after `npm run build`.
 *
 * The bench itself is `webmcp-profiler bench` (packages/webmcp-profiler,
 * §11 of docs/webmcp-profiler-spec.md); this file only starts the
 * preview server and hands it the case file. Network tools (join_session,
 * start_pairing, create_live_handoff) and export_templates are not in the
 * cases: their latency is a Durable Object round trip or a download, not
 * page compute.
 *
 *   npm run perf                  the table
 *   npm run perf -- --overhead    plus the profiler's own overhead per tool
 *   npm run perf -- --json out.json
 */
import { spawn } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { formatBenchTable, runBench } from "webmcp-profiler/bench"

const PORT = 4199
const BASE = `http://localhost:${PORT}`
const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const value = (name) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined)

const executablePath = process.env.CHROMIUM_PATH
  ? process.env.CHROMIUM_PATH
  : existsSync("/opt/pw-browsers/chromium")
    ? "/opt/pw-browsers/chromium"
    : undefined

const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: "ignore" })
const serverReady = async () => {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(BASE)
      if (res.ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error("vite preview never became reachable")
}

try {
  await serverReady()
  const cases = JSON.parse(readFileSync(new URL("./perf.cases.json", import.meta.url), "utf8"))
  const result = await runBench({
    url: BASE,
    cases,
    allowMutating: ["update_design", "apply_preset", "undo_last_change", "open_model"],
    executablePath,
    overhead: flag("overhead"),
    log: (line) => process.stderr.write(line + "\n"),
  })
  console.log("\n" + formatBenchTable(result) + "\n")
  const out = value("json")
  if (out) {
    writeFileSync(out, JSON.stringify({ rows: result.rows, boot: result.boot, report: result.report }, null, 2))
    console.log(`wrote ${out}`)
  }
} finally {
  server.kill()
}
