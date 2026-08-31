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

const mcpHostInit = () => {
  window.__mcpTools = {}
  document.modelContext = { registerTool: (t) => (window.__mcpTools[t.name] = t) }
}

const callTool = (page, name, input = {}) =>
  page.evaluate(
    async ([toolName, toolInput]) => {
      const result = await window.__mcpTools[toolName].execute(toolInput)
      return {
        isError: result.isError ?? false,
        types: result.content.map((c) => c.type),
        text: result.content.find((c) => c.type === "text")?.text ?? "",
        imageBytes: result.content.find((c) => c.type === "image")?.data?.length ?? 0,
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

  const desc = stateFrom(await callTool(page, "describe_project"))
  check(
    "describe_project carries capacity and a session-tagged share link",
    desc.capacityMl > 0 &&
      typeof desc.shareUrl === "string" &&
      desc.shareUrl.includes("type=") &&
      desc.shareUrl.includes("via=chatgpt"),
    JSON.stringify({ capacityMl: desc.capacityMl, shareUrl: desc.shareUrl })
  )

  // ------------------------------------------------------------ set_capacity
  const cap = await callTool(page, "set_capacity", { capacityMl: 500 })
  const capState = stateFrom(cap)
  check(
    "set_capacity solves height for the target volume",
    !cap.isError && Math.abs(capState.capacityMl - 500) <= 2,
    `capacity after: ${capState.capacityMl}`
  )

  // --------------------------------------------------------------- set_units
  const inches = stateFrom(await callTool(page, "set_units", { units: "in" }))
  check(
    "set_units switches every human-facing measurement to inches",
    inches.units === "in" &&
      inches.shareUrl.includes("units=in") &&
      inches.pieces.every((p) => p.includes(" in")),
    JSON.stringify({ units: inches.units, piece: inches.pieces[0] })
  )
  const metric = stateFrom(await callTool(page, "set_units", { units: "cm" }))
  check("set_units switches back to centimeters", metric.units === "cm" && metric.shareUrl.includes("units=cm"))
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
    "get_preview_image returns PNG content",
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
    document.modelContext = { registerTool: (t) => (window.__mcpToolsLate[t.name] = t) }
  })
  await latePage.waitForTimeout(4500) // slow-poll heartbeat is 3s
  const lateCount = await latePage.evaluate(() => Object.keys(window.__mcpToolsLate).length)
  const lateBadge = await latePage.evaluate(
    () => !!document.querySelector('a[href^="/webmcp"] .animate-ping')
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

  // ----------------------------------------------- three badge states
  // 1. no API, no signal -> grey pill just says "WebMCP"
  const plainPage = await ctx.newPage()
  await plainPage.goto(BASE, { waitUntil: "networkidle" })
  await plainPage.waitForTimeout(1200)
  const plainPill = await plainPage.evaluate(() => ({
    text: document.querySelector('a[href^="/webmcp"]')?.textContent?.trim(),
    ping: !!document.querySelector('a[href^="/webmcp"] .animate-ping'),
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
    /print flat/.test(whyHero ?? "") && whyTools === EXPECTED_TOOLS.length,
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
    guideTools === EXPECTED_TOOLS.length &&
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
    text: document.querySelector('a[href^="/webmcp"]')?.textContent?.trim(),
    ping: !!document.querySelector('a[href^="/webmcp"] .animate-ping'),
  }))
  check(
    "an agent-minted link shows 'Connected via ChatGPT' (solid green, no pulse)",
    viaPill.text === "Connected via ChatGPT" && !viaPill.ping,
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
    () => !!document.querySelector('a[href^="/webmcp"] .animate-ping')
  )
  check("the WebMCP pill pulses green when connected", badgeConnected)
  await navPage.close()

  await browser.close()
} catch (error) {
  console.error("E2E harness error:", error)
  failures++
} finally {
  server.kill()
}

console.log(failures === 0 ? "\nE2E: all checks passed" : `\nE2E: ${failures} check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)
