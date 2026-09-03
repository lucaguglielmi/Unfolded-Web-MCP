/**
 * Live health sweep: point it at any deployment of the site and it reports
 * what a visitor and an agent would hit. Routes, console and page errors,
 * failed requests, broken images and internal links, the WebMCP tool
 * surface through the package's fake host, the profiler gate, overlay and
 * get_perf_report on that build, the hosted demo, and the manifest's
 * profiler version.
 *
 *   node e2e/live.mjs                          # https://tryunfolded.com
 *   node e2e/live.mjs http://localhost:4173    # a local preview
 *
 * Exit code 1 when any check fails. Needs a built webmcp-profiler
 * (npm run build -w webmcp-profiler) for the fake host script.
 */
import { existsSync } from "node:fs"
import { chromium } from "playwright"
import { FAKE_HOST_INIT_SCRIPT } from "webmcp-profiler/testing"

const BASE = (process.argv[2] ?? "https://tryunfolded.com").replace(/\/$/, "")
const ROUTES = ["/", "/why", "/webmcp", "/user-flow", "/webmcp-profiler/demo/", "/?type=faceted&height=150&facets=6"]
const NOISE = /WebGL|GL Driver|GPU stall|Download the React DevTools|favicon/i
const executablePath = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined)

let failures = 0
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`)
  if (!ok) failures++
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// sandboxes route egress through a proxy that Chromium does not pick up from
// the environment on its own; localhost stays direct
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } : undefined
// TLS-inspecting proxies can reset Chromium's TLS 1.3 handshake; cap at 1.2 only behind a proxy
const args = proxy ? ["--ssl-version-max=tls1.2"] : []
const browser = await chromium.launch({ executablePath, proxy, args })
try {
  // ---------------------------------------------------------------- routes
  for (const route of ROUTES) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await ctx.newPage()
    const consoleErrors = []
    const pageErrors = []
    const failedRequests = []
    page.on("console", (m) => m.type() === "error" && !NOISE.test(m.text()) && consoleErrors.push(m.text().slice(0, 160)))
    page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 160)))
    page.on("requestfailed", (r) => !NOISE.test(r.url()) && failedRequests.push(`${r.url()} (${r.failure()?.errorText})`))
    page.on("response", (r) => r.status() >= 400 && !NOISE.test(r.url()) && failedRequests.push(`${r.url()} → ${r.status()}`))
    const response = await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 60_000 })
    await wait(1500)
    const facts = await page.evaluate(() => ({
      title: document.title,
      rendered: (document.getElementById("root")?.children.length ?? 0) > 0 || document.body.innerText.length > 200,
      brokenImages: [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.getAttribute("src")),
      internalLinks: [...new Set([...document.querySelectorAll("a[href^='/']")].map((a) => a.getAttribute("href")))],
      text: document.body.innerText.slice(0, 200000),
    }))
    check(`${route}: HTTP ${response?.status()} and rendered`, response?.ok() && facts.rendered, `title=${facts.title}`)
    check(`${route}: no page errors`, pageErrors.length === 0, pageErrors.join(" | "))
    check(`${route}: no console errors`, consoleErrors.length === 0, consoleErrors.join(" | "))
    check(`${route}: no failed requests`, failedRequests.length === 0, failedRequests.join(" | "))
    check(`${route}: no broken images`, facts.brokenImages.length === 0, facts.brokenImages.join(", "))
    check(`${route}: no 'undefined' or 'NaN' rendered as text`, !/\bundefined\b|\bNaN\b/.test(facts.text))
    // internal links resolve (HEAD through the page's own origin)
    const linkResults = await page.evaluate(async (links) => {
      const out = []
      for (const href of links.slice(0, 40)) {
        try {
          const r = await fetch(href, { method: "GET", redirect: "follow" })
          if (!r.ok) out.push(`${href} → ${r.status}`)
        } catch (e) {
          out.push(`${href} → ${String(e)}`)
        }
      }
      return out
    }, facts.internalLinks)
    check(`${route}: internal links resolve (${facts.internalLinks.length})`, linkResults.length === 0, linkResults.join(" | "))
    await ctx.close()
  }

  // -------------------------------------------- the tool surface + profiler
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await ctx.newPage()
    const pageErrors = []
    page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 160)))
    await page.addInitScript(FAKE_HOST_INIT_SCRIPT)
    await page.goto(`${BASE}/?perf=overlay`, { waitUntil: "networkidle", timeout: 60_000 })
    await page.waitForFunction(() => window.__webmcpFakeHost && window.__webmcpFakeHost.tools.size >= 12, undefined, { timeout: 30_000 }).catch(() => undefined)
    await wait(1500)
    const surface = await page.evaluate(async () => {
      const host = window.__webmcpFakeHost
      const names = [...host.tools.keys()]
      const call = (n, i = {}) => host.call(n, i)
      const describe = await call("describe_project")
      const preview = await call("get_preview_image")
      const capacity = await call("update_design", { capacityMl: 350 })
      const form = await call("update_design", { type: "faceted", facets: 6, heightMm: 120, shrinkagePct: 13, units: "in" })
      const summary = await call("get_template_summary")
      const undo = await call("undo_last_change")
      const handoff = await call("create_live_handoff").catch((e) => ({ isError: true, error: String(e) }))
      const pairing = await call("start_pairing").catch((e) => ({ isError: true, error: String(e) }))
      const perf = await call("get_perf_report", { view: "tools" })
      const p = window.__webmcpPerf
      const overlay = document.documentElement.lastElementChild?.shadowRoot
      return {
        names,
        describeOk: describe?.structuredContent?.ok === true && !!describe?.structuredContent?.state,
        previewBytes: preview?.content?.find((c) => c.type === "image")?.data?.length ?? 0,
        capacityOk: capacity?.structuredContent?.ok === true,
        formOk: form?.structuredContent?.ok === true,
        summaryOk: summary?.structuredContent?.ok === true,
        undoOk: undo?.structuredContent?.ok === true,
        handoff: handoff?.structuredContent?.ok ?? !handoff?.isError,
        handoffMessage: handoff?.content?.[0]?.text?.slice(0, 120) ?? handoff?.error,
        pairingCode: pairing?.structuredContent?.code ?? pairing?.content?.[0]?.text?.match(/[A-HJ-NP-Z2-9]{3}-?[A-HJ-NP-Z2-9]{3}/)?.[0] ?? null,
        pairingLink: pairing?.structuredContent?.liveHandoffUrl ?? null,
        pairingMessage: pairing?.content?.[0]?.text?.slice(0, 120) ?? pairing?.error,
        perfOk: perf?.structuredContent?.ok === true && Array.isArray(perf.structuredContent.tools),
        perfVersion: perf?.structuredContent?.session?.version,
        perfFormat: perf?.structuredContent?.format,
        spans: p ? p.spans().length : -1,
        registered: p ? p.ledger().registeredTools.length : -1,
        internal: p ? p.ledger().tools.get_perf_report?.internal : null,
        status: p ? p.status().phase : null,
        summaryText: p ? p.summary() : "",
        overlayRows: overlay ? overlay.querySelectorAll("tr").length - 1 : -1,
        overlayLedger: overlay ? overlay.querySelector(".ledger")?.textContent : null,
      }
    })
    check("tool surface: 12 tools registered on the fake host (get_perf_report included)", surface.names.length === 12 && surface.names.includes("get_perf_report"), surface.names.join(","))
    check("describe_project: ok with a state snapshot", surface.describeOk)
    check("get_preview_image: compact image (< 20 KB base64)", surface.previewBytes > 1000 && surface.previewBytes < 20_000, `${surface.previewBytes}B`)
    check("update_design (capacity, combined) / get_template_summary / undo: ok", surface.capacityOk && surface.formOk && surface.summaryOk && surface.undoOk)
    check("create_live_handoff: reaches the pairing service", surface.handoff === true, surface.handoffMessage)
    check("start_pairing: mints a code from the worker", !!surface.pairingCode, surface.pairingMessage)
    check(
      "start_pairing: mints the tappable link beside it (live-handoff-link-spec §7.1)",
      /[?&]join=[A-Za-z0-9_-]{20,}/.test(surface.pairingLink ?? ""),
      surface.pairingLink ?? surface.pairingMessage
    )
    check("profiler: ?perf=overlay armed, every host call measured", surface.status === "measuring" && surface.spans >= 7, `spans=${surface.spans} phase=${surface.status}`)
    check("profiler: get_perf_report answers with the tools view, format 2, package version", surface.perfOk && surface.perfFormat === "webmcp-perf-report/2" && /^\d+\.\d+\.\d+$/.test(surface.perfVersion ?? ""), `version=${surface.perfVersion}`)
    check("profiler: the report tool is listed as internal and never measured", surface.internal === true && surface.registered === 12)
    check("overlay: rows and the ledger line render", surface.overlayRows >= 5 && /host gaps/.test(surface.overlayLedger ?? ""), `rows=${surface.overlayRows} ledger=${surface.overlayLedger}`)
    check("profiler flow: no page errors", pageErrors.length === 0, pageErrors.join(" | "))
    console.log("\n" + surface.summaryText + "\n")
    await ctx.close()
  }

  // ------------------------------------------ browser caching (spec §8)
  {
    const ctx = await browser.newContext()
    const html = await ctx.request.get(`${BASE}/`)
    const body = await html.text()
    const asset = body.match(/src="(\/assets\/[^"]+\.js)"/)?.[1]
    const assetRes = asset ? await ctx.request.get(`${BASE}${asset}`) : null
    const assetCache = assetRes?.headers()["cache-control"] ?? ""
    const htmlCache = html.headers()["cache-control"] ?? ""
    check("caching: fingerprinted /assets/* are immutable for a year", /immutable/.test(assetCache) && /max-age=31\d{6}/.test(assetCache), `${asset} → ${assetCache}`)
    check("caching: the HTML entry still revalidates", !/immutable/.test(htmlCache), htmlCache)
    await ctx.close()
  }

  // ------------------------------------------------------------ the demo
  {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    const pageErrors = []
    page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 160)))
    await page.goto(`${BASE}/webmcp-profiler/demo/`, { waitUntil: "networkidle", timeout: 60_000 })
    await wait(6000)
    const demo = await page.evaluate(() => ({
      log: document.getElementById("log")?.textContent ?? "",
      overlay: !!document.documentElement.lastElementChild?.shadowRoot?.querySelector("table"),
      version: window.WebMCPProfiler?.PACKAGE_VERSION,
    }))
    check("demo: fires calls and prints the summary", /payloads/.test(demo.log) && demo.overlay, demo.log.slice(0, 120))
    check("demo: the hosted IIFE is the deployed package version", /^\d+\.\d+\.\d+$/.test(demo.version ?? ""), `version=${demo.version}`)
    check("demo: no page errors", pageErrors.length === 0, pageErrors.join(" | "))
    await ctx.close()
  }

  // --------------------------------------------------------- the manifest
  {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.goto(`${BASE}/webmcp`, { waitUntil: "networkidle", timeout: 60_000 })
    // the agent deep-dive (the manifest JSON) is behind the reading-depth toolbar
    await page.getByRole("radio", { name: "I am not human" }).click()
    await wait(800)
    const text = await page.evaluate(() => document.body.innerText)
    check("manifest on /webmcp: embeds the package's describe() with a version", /"name": "webmcp-profiler"/.test(text) && /"version": "\d+\.\d+\.\d+"/.test(text))
    check("manifest on /webmcp: names get_perf_report as the report tool", /get_perf_report/.test(text))
    await ctx.close()
  }
} finally {
  await browser.close()
}
console.log(failures === 0 ? "\nLIVE: all checks passed" : `\nLIVE: ${failures} check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)
