/**
 * The agentless bench: drive a page's WebMCP tools through the fake host
 * in a real browser, record through the profiler itself, and report in
 * the same document shape as a live session. Node only; Playwright is
 * an optional peer dependency resolved at run time.
 */

import { FAKE_HOST_INIT_SCRIPT } from "webmcp-profiler/testing"
import { generateInputs, type SchemaLike } from "./inputs"

/** A pinned case: exact inputs (or a generator index range) for one tool, under a display name. */
export interface BenchCase {
  /** display name; defaults to the tool name */
  name?: string
  tool: string
  /** exact inputs to cycle through; omitted means schema-generated */
  inputs?: unknown[]
  /** runs for this case; defaults to the global runs */
  runs?: number
}

/** Budgets per tool: maxima that fail the bench when exceeded. */
export type BenchBudgets = Record<string, { p95Ms?: number; resultBytes?: number; estTokens?: number }>

/** Options for runBench. */
export interface BenchOptions {
  url: string
  runs?: number
  seed?: number
  /** query parameter that arms the profiler on the page */
  param?: string
  /** tools allowed to run although not annotated readOnlyHint */
  allowMutating?: string[]
  /** pinned cases; tools without a case are schema-driven */
  cases?: BenchCase[]
  budgets?: BenchBudgets
  /** milliseconds to wait for tools to register */
  registrationTimeoutMs?: number
  /** path to a Chromium binary; defaults to Playwright's */
  executablePath?: string
  headless?: boolean
  /** run the same cases a second time without the profiler armed and report the delta */
  overhead?: boolean
  log?: (line: string) => void
}

/** One row of the bench's table. */
export interface BenchRow {
  name: string
  tool: string
  runs: number
  minMs: number
  p50Ms: number
  p95Ms: number
  maxMs: number
  resultBytes: number
  estTokens: number
  schemaBytes: number
  violations: string[]
  /** present with `overhead`: p50/p95 without the profiler armed */
  raw?: { p50Ms: number; p95Ms: number }
}

/** The bench's outcome. */
export interface BenchResult {
  rows: BenchRow[]
  /** the profiler's report document from the armed run */
  report: unknown
  /** navigation timing of the page */
  boot: { domContentLoaded: number; load: number }
  ok: boolean
}

const q = (sorted: number[], p: number): number => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0)

async function loadPlaywright(): Promise<{ chromium: { launch: (o: Record<string, unknown>) => Promise<Browser> } }> {
  try {
    return (await import("playwright")) as never
  } catch {
    throw new Error("webmcp-profiler bench needs Playwright: npm install -D playwright (and npx playwright install chromium)")
  }
}

/** The subset of Playwright the bench uses. */
interface Page {
  addInitScript(script: string): Promise<void>
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>
  waitForFunction(fn: string, arg?: unknown, options?: Record<string, unknown>): Promise<unknown>
  evaluate<R>(fn: string | ((arg: never) => R), arg?: unknown): Promise<R>
  close(): Promise<void>
}
interface Browser {
  newPage(options?: Record<string, unknown>): Promise<Page>
  close(): Promise<void>
}

interface Descriptor {
  name: string
  inputSchema?: SchemaLike
  annotations?: { readOnlyHint?: boolean }
}

async function drive(page: Page, tool: string, inputs: unknown[]): Promise<{ durations: number[]; bytes: number }> {
  return page.evaluate(
    `(async ([toolName, inputList]) => {
      const host = window.__webmcpFakeHost
      const durations = []
      let bytes = 0
      for (const input of inputList) {
        const t0 = performance.now()
        const res = await host.call(toolName, input)
        durations.push(performance.now() - t0)
        bytes = JSON.stringify(res).length
      }
      return { durations, bytes }
    })`,
    [tool, inputs]
  )
}

async function openPage(browser: Browser, url: string, armed: boolean, opts: BenchOptions): Promise<{ page: Page; descriptors: Descriptor[] }> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.addInitScript(FAKE_HOST_INIT_SCRIPT)
  const target = new URL(url)
  if (armed) target.searchParams.set(opts.param ?? "perf", "1")
  await page.goto(target.toString(), { waitUntil: "networkidle" })
  await page.waitForFunction("() => window.__webmcpFakeHost && window.__webmcpFakeHost.tools.size > 0", undefined, {
    timeout: opts.registrationTimeoutMs ?? 20_000,
  })
  // let a polling site finish its whole set
  await page.waitForFunction(
    "(prev) => new Promise((r) => setTimeout(() => r(window.__webmcpFakeHost.tools.size === prev), 1500))",
    await page.evaluate("() => window.__webmcpFakeHost.tools.size")
  )
  const descriptors = await page.evaluate<Descriptor[]>(
    "() => window.__webmcpFakeHost.descriptors().map((t) => ({ name: t.name, inputSchema: t.inputSchema, annotations: t.annotations }))"
  )
  return { page, descriptors }
}

/** Run the bench against a URL. */
export async function runBench(opts: BenchOptions): Promise<BenchResult> {
  const log = opts.log ?? (() => undefined)
  const runs = opts.runs ?? 40
  const { chromium } = await loadPlaywright()
  const browser = await chromium.launch({ headless: opts.headless ?? true, executablePath: opts.executablePath })
  try {
    const { page, descriptors } = await openPage(browser, opts.url, true, opts)
    const byName = new Map(descriptors.map((d) => [d.name, d]))
    const allow = new Set(opts.allowMutating ?? [])
    const cases: BenchCase[] =
      opts.cases ??
      descriptors.map((d) => ({ tool: d.name }))
    const plan = cases
      .filter((c) => {
        const d = byName.get(c.tool)
        if (!d) {
          log(`skip ${c.tool}: not registered`)
          return false
        }
        if (d.annotations?.readOnlyHint !== true && !allow.has(c.tool)) {
          log(`skip ${c.tool}: mutating (add --allow-mutating ${c.tool} to include)`)
          return false
        }
        return true
      })
      .map((c) => ({
        name: c.name ?? c.tool,
        tool: c.tool,
        inputs: c.inputs
          ? Array.from({ length: c.runs ?? runs }, (_, i) => c.inputs![i % c.inputs!.length])
          : generateInputs(byName.get(c.tool)!.inputSchema, { runs: c.runs ?? runs, seed: opts.seed }),
      }))

    await page.evaluate("() => window.__webmcpPerf && window.__webmcpPerf.synthetic(true)")
    const boot = await page.evaluate<{ domContentLoaded: number; load: number }>(
      "() => { const t = performance.getEntriesByType('navigation')[0]; return { domContentLoaded: t.domContentLoadedEventEnd, load: t.loadEventEnd } }"
    )
    const rows: BenchRow[] = []
    for (const c of plan) {
      const { durations, bytes } = await drive(page, c.tool, c.inputs)
      const sorted = [...durations].sort((a, b) => a - b)
      const schemaBytes = await page.evaluate<number>(`() => (window.__webmcpPerf ? window.__webmcpPerf.ledger().tools[${JSON.stringify(c.tool)}]?.schemaBytes ?? 0 : 0)`)
      const row: BenchRow = {
        name: c.name,
        tool: c.tool,
        runs: c.inputs.length,
        minMs: sorted[0] ?? 0,
        p50Ms: q(sorted, 0.5),
        p95Ms: q(sorted, 0.95),
        maxMs: sorted[sorted.length - 1] ?? 0,
        resultBytes: bytes,
        estTokens: Math.ceil(bytes / 4),
        schemaBytes,
        violations: [],
      }
      const budget = opts.budgets?.[c.tool]
      if (budget) {
        if (budget.p95Ms !== undefined && row.p95Ms > budget.p95Ms) row.violations.push(`p95 ${row.p95Ms.toFixed(1)}ms > ${budget.p95Ms}ms`)
        if (budget.resultBytes !== undefined && row.resultBytes > budget.resultBytes) row.violations.push(`result ${row.resultBytes}B > ${budget.resultBytes}B`)
        if (budget.estTokens !== undefined && row.estTokens > budget.estTokens) row.violations.push(`tokens ${row.estTokens} > ${budget.estTokens}`)
      }
      rows.push(row)
      log(`${c.name}: p50 ${row.p50Ms.toFixed(1)}ms · p95 ${row.p95Ms.toFixed(1)}ms · ${bytes}B`)
    }
    const report = await page.evaluate<unknown>("() => (window.__webmcpPerf ? window.__webmcpPerf.report() : null)")
    await page.close()

    if (opts.overhead) {
      const { page: rawPage } = await openPage(browser, opts.url, false, opts)
      for (const c of plan) {
        const { durations } = await drive(rawPage, c.tool, c.inputs)
        const sorted = [...durations].sort((a, b) => a - b)
        const row = rows.find((r) => r.name === c.name)!
        row.raw = { p50Ms: q(sorted, 0.5), p95Ms: q(sorted, 0.95) }
      }
      await rawPage.close()
    }
    return { rows, report, boot, ok: rows.every((r) => r.violations.length === 0) }
  } finally {
    await browser.close()
  }
}

/** The bench's table, as text. */
export function formatBenchTable(result: BenchResult): string {
  const lines = [
    `boot: DOMContentLoaded ${result.boot.domContentLoaded.toFixed(0)}ms, load ${result.boot.load.toFixed(0)}ms`,
    "",
    "tool                      runs   min     p50     p95     max     result-bytes  schema-bytes" +
      (result.rows.some((r) => r.raw) ? "   Δp50 (profiler)   Δp95" : ""),
  ]
  for (const r of result.rows) {
    let line =
      `${r.name.padEnd(25)} ${String(r.runs).padStart(4)}  ${r.minMs.toFixed(1).padStart(6)}  ${r.p50Ms.toFixed(1).padStart(6)}` +
      `  ${r.p95Ms.toFixed(1).padStart(6)}  ${r.maxMs.toFixed(1).padStart(6)}   ${String(r.resultBytes).padStart(10)}  ${String(r.schemaBytes).padStart(11)}`
    if (r.raw) line += `   ${(r.p50Ms - r.raw.p50Ms).toFixed(2).padStart(8)}ms        ${(r.p95Ms - r.raw.p95Ms).toFixed(2).padStart(6)}ms`
    lines.push(line)
    for (const v of r.violations) lines.push(`  ✗ ${r.name}: ${v}`)
  }
  return lines.join("\n")
}
