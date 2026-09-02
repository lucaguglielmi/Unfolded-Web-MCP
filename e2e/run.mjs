/**
 * End-to-end smoke suite: builds are exercised through a real Chromium
 * against the production bundle (vite preview), with a simulated WebMCP
 * host injected before load. Run with `npm run e2e` after `npm run build`.
 *
 * Chromium resolution: $CHROMIUM_PATH if set, else the sandbox's
 * /opt/pw-browsers/chromium, else Playwright's own installed browser
 * (CI runs `npx playwright install chromium` first).
 */
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { chromium } from "playwright"
import { FAKE_HOST_INIT_SCRIPT } from "webmcp-profiler/testing"

const PORT = 4199
const BASE = `http://localhost:${PORT}`
// Deliberately hand-written, NOT derived from src/mcp/tools.ts: this list is
// the independent contract check. A new tool must be added here on purpose —
// e2e failing on an unexpected surface change is the feature.
const EXPECTED_TOOLS = [
  "describe_project",
  "open_model",
  "update_form",
  "set_clay",
  "set_capacity",
  "set_units",
  "get_template_summary",
  "get_preview_image",
  "export_templates",
  "apply_preset",
  "create_live_handoff",
  "join_session",
  "start_pairing",
  "undo_last_change",
]

let failures = 0
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`)
  if (!ok) failures++
}

const executablePath = process.env.CHROMIUM_PATH
  ? process.env.CHROMIUM_PATH
  : existsSync("/opt/pw-browsers/chromium")
    ? "/opt/pw-browsers/chromium"
    : undefined

// ---------------------------------------------------------------- server
const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
  stdio: "ignore",
})
const serverReady = async () => {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(BASE)
      if (res.ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error("vite preview never became reachable")
}

// the package's own fake host (webmcp-profiler/testing): standards-realistic,
// async per-tool promises, abort-driven removal; mirrors tools to __mcpTools
const mcpHostInit = FAKE_HOST_INIT_SCRIPT

const callTool = (page, name, input = {}) =>
  page.evaluate(
    async ([toolName, toolInput]) => {
      const result = await window.__mcpTools[toolName].execute(toolInput)
      return {
        isError: result.isError ?? false,
        types: result.content.map((c) => c.type),
        text: result.content.find((c) => c.type === "text")?.text ?? "",
        imageBytes: result.content.find((c) => c.type === "image")?.data?.length ?? 0,
        // the additive structured half (tool-result/1)
        structured: result.structuredContent ?? null,
      }
    },
    [name, input]
  )

// mutation responses are "<note>\n{json}"; reads are bare json — parse from
// the first line that opens the JSON object
const stateFrom = (res) => {
  const start = res.text.indexOf("{")
  return JSON.parse(res.text.slice(start))
}

try {
  await serverReady()
  const browser = await chromium.launch({ executablePath })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })

  // ------------------------------------------ tools on document.modelContext
  const page = await ctx.newPage()
  await page.addInitScript(mcpHostInit)
  await page.goto(BASE, { waitUntil: "networkidle" })
  // the 3D viewport is a lazy chunk now — give it a beat to mount
  await page.waitForTimeout(2500)

  const names = await page.evaluate(() => Object.keys(window.__mcpTools))
  check(
    "all tools register on document.modelContext",
    EXPECTED_TOOLS.every((t) => names.includes(t)) && names.length === EXPECTED_TOOLS.length,
    `got: ${names.join(", ")}`
  )

  const schemasOk = await page.evaluate(() =>
    Object.values(window.__mcpTools).every(
      (t) => t.description.length > 40 && t.inputSchema && t.inputSchema.type === "object"
    )
  )
  check("every tool has a real description and an object inputSchema", schemasOk)

  // titles at the top level, only current annotation fields
  const descriptorsOk = await page.evaluate(() =>
    Object.values(window.__mcpTools).every(
      (t) =>
        typeof t.title === "string" &&
        t.title.length > 0 &&
        Object.keys(t.annotations ?? {}).every((k) => ["title", "readOnlyHint", "untrustedContentHint"].includes(k))
    )
  )
  check("titles are top-level and annotations carry only current fields", descriptorsOk)

  // the host replacing its registry causes one clean re-registration
  await page.evaluate(() => {
    window.__mcpToolsReplaced = {}
    document.modelContext = {
      registerTool: (t, opts) =>
        new Promise((resolve) => {
          setTimeout(() => {
            if (opts?.signal?.aborted) return resolve()
            window.__mcpToolsReplaced[t.name] = t
            resolve()
          }, 2)
        }),
    }
  })
  // detection rides the slow 3s heartbeat and the awaited registrations
  // (one per EXPECTED_TOOLS entry) land one by one, so poll for completion instead of sampling a fixed
  // instant (a fixed 4.5s wait caught slow CI runners mid-registration)
  await page
    .waitForFunction(
      (count) => Object.keys(window.__mcpToolsReplaced).length === count,
      EXPECTED_TOOLS.length,
      { timeout: 15_000 }
    )
    .catch(() => {})
  const replaced = await page.evaluate(() => Object.keys(window.__mcpToolsReplaced).length)
  check(
    "replacing document.modelContext re-registers all tools on the new registry",
    replaced === EXPECTED_TOOLS.length,
    `re-registered: ${replaced}`
  )
  // hand the rest of the suite the live registry
  await page.evaluate(() => (window.__mcpTools = window.__mcpToolsReplaced))

  const descRes = await callTool(page, "describe_project")
  const desc = stateFrom(descRes)
  check(
    "describe_project carries capacity and a permanent, token-free designUrl",
    desc.capacityMl > 0 &&
      typeof desc.designUrl === "string" &&
      desc.designUrl.includes("type=") &&
      !desc.designUrl.includes("via=") &&
      !desc.designUrl.includes("join=") &&
      desc.shareUrl === undefined &&
      desc.liveHandoffTool === "create_live_handoff",
    JSON.stringify({ capacityMl: desc.capacityMl, designUrl: desc.designUrl })
  )
  // no /api in this static harness: the live link must fail CLOSED — an
  // error and no URL of any kind, never a permanent link in its place
  const handoff = await callTool(page, "create_live_handoff")
  check(
    "create_live_handoff without a pairing service returns an error and no link",
    handoff.isError === true && !/https?:\/\//.test(handoff.text) && !handoff.text.includes("?type="),
    handoff.text.slice(0, 120)
  )

  // ------------------------------------------------------------ set_capacity
  const cap = await callTool(page, "set_capacity", { capacityMl: 500 })
  const capState = stateFrom(cap)
  check(
    "set_capacity solves height for the target volume",
    !cap.isError && Math.abs(capState.capacityMl - 500) <= 2,
    `capacity after: ${capState.capacityMl}`
  )
  // 9.3: the structured half rides beside the untouched text on a read and
  // a mutation alike — ok mirrors !isError and state is the text's JSON
  const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  check(
    "describe_project and set_capacity carry structuredContent (tool-result/1)",
    descRes.structured?.ok === true &&
      typeof descRes.structured.message === "string" &&
      sameJson(descRes.structured.state, desc) &&
      cap.structured?.ok === true &&
      cap.structured.message.startsWith("Height set to") &&
      sameJson(cap.structured.state, capState),
    JSON.stringify({ describe: descRes.structured?.ok, mutation: cap.structured?.message })
  )

  // --------------------------------------------------------------- set_units
  const inches = stateFrom(await callTool(page, "set_units", { units: "in" }))
  check(
    "set_units switches every human-facing measurement to inches",
    inches.units === "in" &&
      inches.designUrl.includes("units=in") &&
      inches.pieces.every((p) => p.includes(" in")),
    JSON.stringify({ units: inches.units, piece: inches.pieces[0] })
  )
  const metric = stateFrom(await callTool(page, "set_units", { units: "cm" }))
  check("set_units switches back to centimeters", metric.units === "cm" && metric.designUrl.includes("units=cm"))
  const unitToggles = await page
    .locator('[role="radiogroup"][aria-label="Measurement units"]')
    .count()
  check("units toggle present in both the params panel and the 3D preview", unitToggles === 2)

  // ---------------------------------------------------- legacy + taper model
  const legacy = stateFrom(await callTool(page, "update_form", { type: "tapered" }))
  check(
    "legacy type 'tapered' maps to round + tapered",
    legacy.form.type === "round" && legacy.form.tapered === true
  )
  const hexT = stateFrom(
    await callTool(page, "update_form", { type: "faceted", facets: 6, tapered: true, topDiameterMm: 150, bottomDiameterMm: 100 })
  )
  check(
    "tapered prisms unroll to trapezoid panels",
    hexT.pieces.some((p) => p.includes("trapezoid")),
    hexT.pieces.join(" | ")
  )

  // ------------------------------------------------------------------- undo
  const undone = stateFrom(await callTool(page, "undo_last_change"))
  check("undo_last_change reverts the agent's edit", undone.form.type === "round")

  // ---------------------------------------------------------- preview image
  const img = await callTool(page, "get_preview_image")
  check(
    "get_preview_image returns compact image content",
    img.types[0] === "image" && img.imageBytes > 5000,
    `types: ${img.types.join("+")}, bytes: ${img.imageBytes}`
  )

  // ----------------------------------------------------------------- export
  const download = page.waitForEvent("download", { timeout: 30000 })
  const exp = await callTool(page, "export_templates", {})
  const dl = await download
  const path = await dl.path()
  const { statSync } = await import("node:fs")
  check(
    "export_templates downloads a real PDF",
    !exp.isError && path !== null && statSync(path).size > 10000,
    `size: ${path ? statSync(path).size : "n/a"}`
  )

  // -------------------------------------------------------------- deep link
  await page.goto(`${BASE}/?type=pentagon&height=150&bottom=120&top=80&shrinkage=10&wall=4`, {
    waitUntil: "networkidle",
  })
  await page.waitForTimeout(1200)
  const linked = stateFrom(await callTool(page, "describe_project"))
  check(
    "share links boot the exact design (tapered pentagon)",
    linked.form.type === "faceted" &&
      linked.form.facets === 5 &&
      linked.form.tapered === true &&
      linked.form.heightMm === 150
  )

  // -------------------------------------------------- URL tracks agent edits
  await callTool(page, "update_form", { heightMm: 200 })
  await page.waitForTimeout(700)
  const liveUrl = await page.evaluate(() => window.location.search)
  check("the address bar live-tracks agent edits", liveUrl.includes("height=200"), liveUrl)
  await page.close()

  // ------------------------------------ late injection (agent browsers)
  // ChatGPT-style hosts may inject modelContext only when the person first
  // engages the agent — long after load. The app must catch it anyway.
  const latePage = await ctx.newPage()
  await latePage.goto(BASE, { waitUntil: "networkidle" })
  await latePage.waitForTimeout(2000) // well past initial registration attempts
  await latePage.evaluate(() => {
    window.__mcpToolsLate = {}
    document.modelContext = {
      registerTool: (t, opts) =>
        new Promise((resolve) => {
          setTimeout(() => {
            if (opts?.signal?.aborted) return resolve()
            window.__mcpToolsLate[t.name] = t
            opts?.signal?.addEventListener("abort", () => delete window.__mcpToolsLate[t.name])
            resolve()
          }, 2)
        }),
    }
  })
  // the slow-poll heartbeat is 3s and the 14 registrations then land one
  // awaited tick at a time — poll for the full set (a fixed 4.5s wait
  // sampled a loaded runner mid-registration at 10 or 13 tools)
  await latePage
    .waitForFunction(
      (count) => Object.keys(window.__mcpToolsLate).length === count,
      EXPECTED_TOOLS.length,
      { timeout: 15_000 }
    )
    .catch(() => {})
  const lateCount = await latePage.evaluate(() => Object.keys(window.__mcpToolsLate).length)
  const lateBadge = await latePage.evaluate(
    () => !!document.querySelector('[data-connection-hub] .animate-ping')
  )
  check(
    "tools register and the pill lights even when the API is injected late",
    lateCount === EXPECTED_TOOLS.length && lateBadge,
    `tools: ${lateCount}, badge green: ${lateBadge}`
  )
  const consoleHook = await latePage.evaluate(
    () => typeof window.__unfoldedTools?.describe_project?.execute === "function"
  )
  check("__unfoldedTools console hook is exposed for manual testing", consoleHook)
  await latePage.close()

  // ------------------------------------ visibility transitions
  // A hidden tab must not poll for a host; the visibilitychange recheck
  // must catch up the moment the tab is visible again. document.hidden is
  // faked via a configurable getter so the transition is deterministic.
  const hiddenPage = await ctx.newPage()
  await hiddenPage.addInitScript(() => {
    window.__fakeHidden = true
    Object.defineProperty(document, "hidden", { get: () => window.__fakeHidden === true })
    Object.defineProperty(document, "visibilityState", {
      get: () => (window.__fakeHidden ? "hidden" : "visible"),
    })
  })
  await hiddenPage.goto(BASE, { waitUntil: "networkidle" })
  await hiddenPage.waitForTimeout(1500) // past the mount attempt (which found no host)
  await hiddenPage.evaluate(() => {
    window.__mcpToolsHidden = {}
    document.modelContext = {
      registerTool: (t, opts) =>
        new Promise((resolve) => {
          setTimeout(() => {
            if (opts?.signal?.aborted) return resolve()
            window.__mcpToolsHidden[t.name] = t
            opts?.signal?.addEventListener("abort", () => delete window.__mcpToolsHidden[t.name])
            resolve()
          }, 2)
        }),
    }
  })
  // several fast-poll ticks pass while "hidden" — the host must stay undiscovered
  await hiddenPage.waitForTimeout(2500)
  const registeredWhileHidden = await hiddenPage.evaluate(
    () => Object.keys(window.__mcpToolsHidden).length
  )
  check("a hidden tab does not poll for a WebMCP host", registeredWhileHidden === 0)
  await hiddenPage.evaluate(() => {
    window.__fakeHidden = false
    document.dispatchEvent(new Event("visibilitychange"))
  })
  await hiddenPage
    .waitForFunction(
      (count) => Object.keys(window.__mcpToolsHidden).length === count,
      EXPECTED_TOOLS.length,
      { timeout: 15_000 }
    )
    .catch(() => {})
  const afterVisible = await hiddenPage.evaluate(
    () => Object.keys(window.__mcpToolsHidden).length
  )
  check(
    "the visibilitychange recheck registers the full set once visible",
    afterVisible === EXPECTED_TOOLS.length,
    `tools after visible: ${afterVisible}`
  )
  await hiddenPage.close()

  // ----------------------------------------------- three badge states
  // 1. no API, no signal -> grey pill just says "WebMCP"
  const plainPage = await ctx.newPage()
  await plainPage.goto(BASE, { waitUntil: "networkidle" })
  await plainPage.waitForTimeout(1200)
  const plainPill = await plainPage.evaluate(() => ({
    text: document.querySelector('[data-connection-hub]')?.textContent?.trim(),
    ping: !!document.querySelector('[data-connection-hub] .animate-ping'),
  }))
  check(
    "no API and no signal shows plain 'WebMCP' (grey, no pulse)",
    plainPill.text === "WebMCP" && !plainPill.ping,
    JSON.stringify(plainPill)
  )
  await plainPage.close()

  // /why: the README-as-a-page explainer with the reading-depth toolbar
  const whyPage = await ctx.newPage()
  await whyPage.goto(`${BASE}/why`, { waitUntil: "networkidle" })
  await whyPage.waitForTimeout(800)
  const whyHero = await whyPage.getByRole("heading", { level: 1 }).textContent()
  const whyTools = await whyPage.locator("dt").count()
  check(
    "/why defaults to the 5-minute read with every tool listed",
    /print flat/.test(whyHero ?? "") && whyTools === EXPECTED_TOOLS.length + 1 /* + get_perf_report, listed as conditional */,
    `hero: ${whyHero}, tools: ${whyTools}`
  )
  await whyPage.getByRole("radio", { name: "1 minute" }).click()
  const oneMin = await whyPage.getByText("That's the minute").isVisible()
  await whyPage.getByRole("radio", { name: "I am not human" }).click()
  const agentHero = await whyPage.getByRole("heading", { level: 1 }).textContent()
  const agentDepth = await whyPage.locator("dt").count()
  check(
    "/why's depth toolbar switches between digest and agent deep-dive",
    oneMin && /Hello, agent/.test(agentHero ?? "") && agentDepth > 30,
    `1min: ${oneMin}, agent hero: ${agentHero}, agent facts: ${agentDepth}`
  )
  await whyPage.close()

  // /webmcp: same reading-depth toolbar, agent view addresses the reader
  const guidePage = await ctx.newPage()
  await guidePage.goto(`${BASE}/webmcp`, { waitUntil: "networkidle" })
  await guidePage.waitForTimeout(800)
  const guideTools = await guidePage.locator("dt").count()
  await guidePage.getByRole("radio", { name: "I am not human" }).click()
  const guideAgentHero = await guidePage.getByRole("heading", { level: 1 }).textContent()
  const humanEgg = await guidePage.getByText("congratulations").isVisible()
  const copyBtn = await guidePage.getByRole("button", { name: "Copy prompt" }).isVisible()
  check(
    "/webmcp has the depth toolbar, agent deep dive, and the human easter egg",
    guideTools === EXPECTED_TOOLS.length + 1 /* + get_perf_report, listed as conditional */ &&
      /Hello, agent/.test(guideAgentHero ?? "") &&
      humanEgg &&
      copyBtn,
    `tools: ${guideTools}, agent hero: ${guideAgentHero}, egg: ${humanEgg}/${copyBtn}`
  )
  await guidePage.close()

  // 2. agent-minted link (?via=chatgpt), still no direct API -> solid green
  const viaPage = await ctx.newPage()
  await viaPage.goto(`${BASE}/?type=hexagon&height=120&via=chatgpt`, { waitUntil: "networkidle" })
  await viaPage.waitForTimeout(1200)
  const viaPill = await viaPage.evaluate(() => ({
    text: document.querySelector('[data-connection-hub]')?.textContent?.trim(),
    ping: !!document.querySelector('[data-connection-hub] .animate-ping'),
  }))
  check(
    "an agent-minted link shows 'Opened from ChatGPT' (solid green, no pulse)",
    viaPill.text === "Opened from ChatGPT" && !viaPill.ping,
    JSON.stringify(viaPill)
  )
  await viaPage.close()

  // -------------------------------------------------- Chrome flag nudge
  // Real Chrome without WebMCP gets a one-time tip pointing at the flag.
  // Headless/branded browsers are excluded, so simulate a real Chrome UA.
  const chromeCtx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
  })
  const nudgePage = await chromeCtx.newPage()
  await nudgePage.addInitScript(() => {
    Object.defineProperty(navigator, "userAgentData", { get: () => undefined })
  })
  await nudgePage.goto(BASE, { waitUntil: "networkidle" })
  await nudgePage.waitForTimeout(4200) // nudge waits 3s for a host to appear
  const nudgeShown = await nudgePage.evaluate(
    () => document.body.innerText.includes("chrome://flags/#enable-webmcp-testing")
  )
  check("Chrome without WebMCP gets the flag nudge", nudgeShown)
  await nudgePage.getByRole("button", { name: "No thanks" }).click()
  await nudgePage.reload({ waitUntil: "networkidle" })
  await nudgePage.waitForTimeout(4200)
  const nudgeAfterDismiss = await nudgePage.evaluate(
    () => document.body.innerText.includes("chrome://flags/#enable-webmcp-testing")
  )
  check("dismissing the nudge is remembered across reloads", !nudgeAfterDismiss)
  await nudgePage.close()

  // Chrome WITH WebMCP never sees the nudge
  const quietPage = await chromeCtx.newPage()
  await quietPage.addInitScript(() => {
    Object.defineProperty(navigator, "userAgentData", { get: () => undefined })
    window.localStorage?.removeItem?.("unfolded:chrome-flag-nudge-dismissed")
    document.modelContext = { registerTool: () => {} }
  })
  await quietPage.goto(BASE, { waitUntil: "networkidle" })
  await quietPage.waitForTimeout(4200)
  const nudgeWithHost = await quietPage.evaluate(
    () => document.body.innerText.includes("chrome://flags/#enable-webmcp-testing")
  )
  check("Chrome with a WebMCP host never sees the nudge", !nudgeWithHost)
  // same tab, /webmcp: the Chrome card detects the enabled flag (API present
  // + registration succeeded) and shows the good-news pill
  await quietPage.goto(`${BASE}/webmcp`, { waitUntil: "networkidle" })
  await quietPage
    .waitForFunction(
      () => document.body.innerText.includes("your WebMCP flag is enabled"),
      null,
      { timeout: 10000 }
    )
    .catch(() => {})
  check(
    "/webmcp shows the flag-enabled good-news pill in Chrome with a host",
    await quietPage.evaluate(() =>
      document.body.innerText.includes("your WebMCP flag is enabled in this Chrome session")
    )
  )
  await quietPage.close()
  await chromeCtx.close()

  // -------------------------------------- navigator.modelContext fallback
  const navPage = await ctx.newPage()
  await navPage.addInitScript(() => {
    window.__mcpTools = {}
    Object.defineProperty(navigator, "modelContext", {
      value: { registerTool: (t) => (window.__mcpTools[t.name] = t) },
    })
  })
  await navPage.goto(BASE, { waitUntil: "networkidle" })
  await navPage.waitForTimeout(1500)
  const navCount = await navPage.evaluate(() => Object.keys(window.__mcpTools).length)
  check("tools also register via navigator.modelContext", navCount === EXPECTED_TOOLS.length)
  const badgeConnected = await navPage.evaluate(
    () => !!document.querySelector('[data-connection-hub] .animate-ping')
  )
  check("the connection hub pulses green when connected", badgeConnected)
  await navPage.close()

  // ------------------------------------------------- webmcp profiler
  // ?perf=1 attaches the profiler before tools register; every host call
  // must land as a span with payload accounting. Own context: the flag
  // persists in localStorage and must not leak into other checks.
  const perfCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const perfPage = await perfCtx.newPage()
  await perfPage.addInitScript(mcpHostInit)
  await perfPage.goto(`${BASE}/?perf=1`, { waitUntil: "networkidle" })
  await perfPage.waitForTimeout(2500)
  await callTool(perfPage, "describe_project")
  await callTool(perfPage, "update_form", { heightMm: 210 })
  const perf = await perfPage.evaluate(async () => {
    const p = window.__webmcpPerf
    if (!p) return null
    const spans = p.spans()
    const report = p.report()
    const host = window.__webmcpFakeHost
    const viaTool = await host.call("get_perf_report", { view: "summary" })
    return {
      spanCount: spans.length,
      tools: spans.map((s) => s.tool),
      bytesOk: spans.every((s) => s.resultBytes > 100 && s.estTokens > 0),
      format: report.format,
      sessionOk: /^[0-9a-f]{8}$/.test(report.session.id),
      registered: report.ledger.registeredTools.length,
      registeredNames: report.ledger.registeredTools,
      schemaOk: report.ledger.registeredTools.every((n) => report.ledger.tools[n].schemaBytes > 0),
      reportToolInternal: report.ledger.tools.get_perf_report?.internal === true,
      toolOk: viaTool.structuredContent?.ok === true && viaTool.content?.[0]?.text?.includes("payloads"),
    }
  })
  check(
    "?perf=1 profiles host tool calls into spans with payload accounting (report format 2)",
    perf !== null &&
      perf.spanCount >= 2 &&
      perf.tools.includes("describe_project") &&
      perf.bytesOk &&
      perf.format === "webmcp-perf-report/2" &&
      perf.sessionOk &&
      perf.schemaOk,
    JSON.stringify(perf)
  )
  check(
    "?perf=1 registers get_perf_report as the fifteenth tool and an agent can read the report through it",
    perf !== null &&
      perf.registered === EXPECTED_TOOLS.length + 1 &&
      perf.registeredNames.includes("get_perf_report") &&
      perf.reportToolInternal &&
      perf.toolOk &&
      !perf.tools.includes("get_perf_report"),
    JSON.stringify(perf)
  )
  await perfCtx.close()

  await browser.close()
} catch (error) {
  console.error("E2E harness error:", error)
  failures++
} finally {
  server.kill()
}

console.log(failures === 0 ? "\nE2E: all checks passed" : `\nE2E: ${failures} check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)
