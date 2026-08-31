/**
 * Timing probe: how long does each WebMCP tool's execute() actually take
 * in-page, called exactly the way a host calls it? Production bundle via
 * vite preview, real Chromium. Run with `npm run perf` after `npm run build`.
 *
 * Reports min / p50 / p95 / max over N runs, plus result payload size —
 * a big payload is a cost the page never sees: the HOST has to serialize
 * it into the model's context, and the model has to read it. Network
 * tools (join_session, start_pairing) are excluded: their latency is a
 * Durable Object round trip, not page compute, and the preview server
 * has no worker behind it.
 *
 * Baseline (2026-08-31, sandbox Chromium): every tool p50 ≤ 5 ms,
 * p95 ≤ 13 ms — tool execution is NOT where agent-perceived latency
 * comes from. See docs/webmcp-profiler-spec.md for the full picture.
 */
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { chromium } from "playwright"

const PORT = 4199
const BASE = `http://localhost:${PORT}`
const N = 40

const executablePath = process.env.CHROMIUM_PATH
  ? process.env.CHROMIUM_PATH
  : existsSync("/opt/pw-browsers/chromium")
    ? "/opt/pw-browsers/chromium"
    : undefined

const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
  stdio: "ignore",
})
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

// input generators: vary the payload per iteration so memoized paths
// (identical state → cache hits) don't flatter the numbers
const CASES = [
  { name: "describe_project", input: () => ({}) },
  { name: "get_template_summary", input: () => ({}) },
  { name: "update_form", input: (i) => ({ heightMm: 80 + (i % 40) * 5 }) },
  { name: "update_form (type flip)", tool: "update_form", input: (i) => (i % 2 ? { type: "faceted", facets: 6 } : { type: "round" }) },
  { name: "set_clay", input: (i) => ({ shrinkagePct: 8 + (i % 10) }) },
  { name: "set_capacity", input: (i) => ({ capacityMl: 300 + (i % 20) * 10 }) },
  { name: "set_units", input: (i) => ({ units: i % 2 ? "in" : "cm" }) },
  { name: "apply_preset", input: (i) => ({ preset: i % 2 ? "classic-mug" : "cereal-bowl" }) },
  { name: "undo_last_change", input: () => ({}) },
  { name: "open_model", input: (i) => ({ url: `http://localhost:4199/?type=round&height=${100 + (i % 30)}` }) },
  { name: "get_preview_image", input: () => ({}), n: 15 },
]

try {
  await serverReady()
  const browser = await chromium.launch({ executablePath })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.addInitScript(() => {
    window.__mcpTools = {}
    document.modelContext = { registerTool: (t) => (window.__mcpTools[t.name] = t) }
  })
  await page.goto(BASE, { waitUntil: "networkidle" })
  await page.waitForTimeout(3000) // let the lazy 3D chunk mount

  // registration cost: how long did the page take from boot to tools ready?
  const nav = await page.evaluate(() => {
    const t = performance.getEntriesByType("navigation")[0]
    return { domContentLoaded: t.domContentLoadedEventEnd, load: t.loadEventEnd }
  })

  const rows = []
  for (const c of CASES) {
    const tool = c.tool ?? c.name
    const runs = c.n ?? N
    const inputs = Array.from({ length: runs }, (_, i) => c.input(i))
    const r = await page.evaluate(
      async ([toolName, inputList]) => {
        const t = window.__mcpTools[toolName]
        const durations = []
        let bytes = 0
        for (const input of inputList) {
          const t0 = performance.now()
          const res = await t.execute(input)
          durations.push(performance.now() - t0)
          bytes = JSON.stringify(res).length
        }
        durations.sort((a, b) => a - b)
        const q = (p) => durations[Math.min(durations.length - 1, Math.floor(p * durations.length))]
        return {
          min: durations[0],
          p50: q(0.5),
          p95: q(0.95),
          max: durations[durations.length - 1],
          bytes,
        }
      },
      [tool, inputs]
    )
    rows.push({ tool: c.name, runs, ...r })
  }

  console.log(`\nboot: DOMContentLoaded ${nav.domContentLoaded.toFixed(0)}ms, load ${nav.load.toFixed(0)}ms\n`)
  console.log("tool                      runs   min     p50     p95     max     result-bytes")
  for (const r of rows) {
    console.log(
      `${r.tool.padEnd(25)} ${String(r.runs).padStart(4)}  ${r.min.toFixed(1).padStart(6)}  ${r.p50.toFixed(1).padStart(6)}  ${r.p95.toFixed(1).padStart(6)}  ${r.max.toFixed(1).padStart(6)}   ${r.bytes}`
    )
  }
  await browser.close()
} finally {
  server.kill()
}
