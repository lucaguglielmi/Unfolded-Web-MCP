/**
 * Drive a deployment through a REAL WebMCP host: Chrome 152+ (Chrome for
 * Testing works) with --enable-features=WebMCPTesting exposes a native
 * document.modelContext, and its DevTools protocol's WebMCP domain lets a
 * client act as the agent host (toolsAdded, invokeTool, toolResponded).
 * The profiler inside the page measures the page's side; this script
 * measures the host's side (invokeTool → toolResponded) and prints both,
 * then reads the report back through get_perf_report like an agent would.
 *
 *   CHROME_PATH=/path/to/chrome node e2e/native-host.mjs [url] [--runs 20]
 *
 * CHROME_PATH must point at a Chromium 152 or newer binary; the bundled
 * Playwright Chromium (141) has no WebMCP. Download one from
 * https://googlechromelabs.github.io/chrome-for-testing/ (Stable, linux64).
 */
import { existsSync } from "node:fs"
import { chromium } from "playwright"

const BASE = (process.argv.find((a) => a.startsWith("http")) ?? "https://tryunfolded.com").replace(/\/$/, "")
const runs = Number(process.argv[process.argv.indexOf("--runs") + 1]) || 20
const exe = process.env.CHROME_PATH
if (!exe || !existsSync(exe)) {
  console.error("native-host: set CHROME_PATH to a Chrome 152+ binary (see the header comment)")
  process.exit(2)
}
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } : undefined
const args = ["--no-sandbox", "--enable-features=WebMCPTesting", ...(proxy ? ["--ssl-version-max=tls1.2"] : [])]
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0 }

let failures = 0
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`)
  if (!ok) failures++
}

const browser = await chromium.launch({ executablePath: exe, proxy, args })
try {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  const tools = new Map()
  const waiting = new Map()
  const responses = new Map()
  cdp.on("WebMCP.toolsAdded", (p) => p.tools.forEach((t) => tools.set(t.name, t)))
  cdp.on("WebMCP.toolsRemoved", (p) => p.tools.forEach((t) => tools.delete(t.name)))
  cdp.on("WebMCP.toolResponded", (p) => {
    const w = waiting.get(p.invocationId)
    if (w) w(p)
    else responses.set(p.invocationId, p)
  })
  await cdp.send("WebMCP.enable")
  await page.goto(`${BASE}/?perf=1`, { waitUntil: "networkidle", timeout: 60_000 })
  await page.waitForFunction(() => window.__webmcpPerf?.status().phase === "tools-registered", undefined, { timeout: 30_000 }).catch(() => undefined)
  await page.waitForTimeout(1000)
  const version = await page.evaluate(() => navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0])
  const native = await page.evaluate(() => "modelContext" in document && Object.getPrototypeOf(document.modelContext) !== Object.prototype)
  check(`native host: document.modelContext is a platform object (${version}, WebMCPTesting)`, native)
  check(`native host: the site registered its tools (${tools.size})`, tools.size >= 12, [...tools.keys()].join(","))
  check("profiler: found the host on document", (await page.evaluate(() => window.__webmcpPerf?.ledger().hostLocation)) === "document")

  const invoke = async (toolName, input = {}) => {
    const tool = tools.get(toolName)
    if (!tool) throw new Error(`no tool ${toolName}`)
    const t0 = performance.now()
    const { invocationId } = await cdp.send("WebMCP.invokeTool", { frameId: tool.frameId, toolName, input })
    const res = responses.has(invocationId)
      ? responses.get(invocationId)
      : await new Promise((resolve) => {
          const timer = setTimeout(() => resolve({ status: "Timeout" }), 30_000)
          waiting.set(invocationId, (p) => { clearTimeout(timer); resolve(p) })
        })
    responses.delete(invocationId)
    let output = res.output
    if (typeof output === "string") { try { output = JSON.parse(output) } catch { /* text output */ } }
    return { status: res.status, hostMs: performance.now() - t0, output, errorText: res.errorText }
  }

  // an agent-like session: read, mutate, look, read again
  const session = [
    ["describe_project", {}], ["update_design", { capacityMl: 350 }], ["update_design", { type: "faceted", facets: 6, heightMm: 120, shrinkagePct: 13, units: "in" }],
    ["get_preview_image", {}], ["get_template_summary", {}], ["undo_last_change", {}], ["describe_project", {}],
  ]
  const results = []
  for (const [name, input] of session) {
    await page.waitForTimeout(200 + Math.random() * 400)
    results.push([name, await invoke(name, input)])
  }
  check("session: every call completed through the host", results.every(([, r]) => r.status === "Completed"), results.map(([n, r]) => `${n}:${r.status}`).join(","))
  check("session: results carry structuredContent.ok", results.every(([, r]) => r.output?.structuredContent?.ok === true))

  // host overhead percentiles: the same read-only tool, repeatedly
  const hostTimes = { describe_project: [], get_preview_image: [] }
  for (let i = 0; i < runs; i++) {
    for (const name of Object.keys(hostTimes)) hostTimes[name].push((await invoke(name)).hostMs)
  }

  const report = await invoke("get_perf_report", { view: "tools" })
  const sc = report.output?.structuredContent
  check("get_perf_report: readable through the native host", report.status === "Completed" && sc?.ok === true && sc?.format === "webmcp-perf-report/2")
  check("get_perf_report: is itself never measured", !sc?.tools?.some((t) => t.tool === "get_perf_report"))

  console.log("\nhost→response (invokeTool to toolResponded) vs page compute (the profiler's wallMs), same calls:")
  console.log("tool                    runs   host p50    host p95    page p50    page p95   host overhead p50")
  for (const [name, times] of Object.entries(hostTimes)) {
    const agg = sc?.tools?.find((t) => t.tool === name)
    const p50 = q(times, 0.5), p95 = q(times, 0.95)
    console.log(`${name.padEnd(23)} ${String(times.length).padStart(4)}  ${p50.toFixed(1).padStart(8)} ms ${p95.toFixed(1).padStart(8)} ms  ${(agg?.p50Ms ?? 0).toFixed(1).padStart(8)} ms ${(agg?.p95Ms ?? 0).toFixed(1).padStart(8)} ms   ${(p50 - (agg?.p50Ms ?? 0)).toFixed(1).padStart(8)} ms`)
  }
  console.log(`\nget_perf_report through the host: ${report.hostMs.toFixed(0)} ms, ${JSON.stringify(report.output ?? "").length} B for the tools view`)
  console.log(report.output?.content?.[0]?.text?.split("\n").slice(0, 2).join("\n"))
  console.log(`ledger: host=${sc?.status?.hostLocation} calls=${sc?.totals?.calls} schemaBytes=${sc?.totals?.schemaBytes} hostGaps=${Math.round(sc?.totals?.hostGapMs ?? 0)}ms package=${sc?.session?.version}`)
} finally {
  await browser.close()
}
console.log(failures === 0 ? "\nNATIVE HOST: all checks passed" : `\nNATIVE HOST: ${failures} check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)
