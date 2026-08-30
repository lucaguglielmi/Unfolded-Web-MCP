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
const EXPECTED_TOOLS = [
  "describe_project",
  "open_model",
  "update_form",
  "set_clay",
  "set_capacity",
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
    "describe_project carries capacity and a share link",
    desc.capacityMl > 0 && typeof desc.shareUrl === "string" && desc.shareUrl.includes("type="),
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
    () => !!document.querySelector('a[href="/webmcp"] .animate-ping')
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
    () => !!document.querySelector('a[href="/webmcp"] .animate-ping')
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
