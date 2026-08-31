/**
 * Full-stack pairing e2e: the built app served by `wrangler dev` (assets +
 * Durable Objects), two real Chromium contexts. Context A mints a code in
 * the Pair dialog; context B enters it, adopts A's design, and edits flow
 * both ways — asserted through the address bar, which live-tracks the
 * design. Run with `npm run e2e:pairing` after `npm run build`.
 */
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { chromium } from "playwright"

const PORT = 8789
const BASE = `http://localhost:${PORT}`
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

const server = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--local"], {
  stdio: "ignore",
})
for (let i = 0; i < 120; i++) {
  try {
    if ((await fetch(BASE)).ok) break
  } catch {
    /* not up yet */
  }
  await new Promise((r) => setTimeout(r, 500))
}

// same simulated WebMCP host as e2e/run.mjs — gives us __unfoldedTools to
// drive edits without reaching into React internals
const mcpHostInit = () => {
  window.__mcpTools = {}
  document.modelContext = { registerTool: (t) => (window.__mcpTools[t.name] = t) }
}

const browser = await chromium.launch({ executablePath })
try {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const a = await ctxA.newPage()
  const b = await ctxB.newPage()
  for (const page of [a, b]) await page.addInitScript(mcpHostInit)

  // A starts from a distinctive design; B from the default mug
  await a.goto(`${BASE}/?type=hexagon&height=180&bottom=140&name=Pairing%20planter`)
  await b.goto(BASE)
  await a.waitForFunction(() => window.__mcpTools?.describe_project)
  await b.waitForFunction(() => window.__mcpTools?.describe_project)

  // A mints a code in the Pair dialog
  await a.click('button[aria-label="Pair a device"]')
  await a.click("text=Create pairing code")
  const codeText = await a.textContent("code.font-mono", { timeout: 15000 })
  const code = (codeText ?? "").replace(/[^A-Z2-9]/g, "")
  check("A mints a 6-glyph code in the dialog", /^[A-HJ-NP-Z2-9]{6}$/.test(code), codeText ?? "none")

  // B enters it and follows A's session
  await b.click('button[aria-label="Pair a device"]')
  await b.fill('input[aria-label="Pairing code from your other device"]', code)
  await b.click('button:text-is("Join")')
  await b.waitForSelector("text=Paired — this device now follows that session.", { timeout: 10000 })
  await b.waitForFunction(() => window.location.search.includes("hexagon"), null, { timeout: 10000 })
  check(
    "B adopts A's design on join (claimer follows)",
    (await b.evaluate(() => window.location.search)).includes("Pairing"),
    await b.evaluate(() => window.location.search)
  )
  check("both dialogs report 2 devices", (await b.textContent("body"))?.includes("Synced live — 2 devices") ?? false)
  await a.keyboard.press("Escape")
  await b.keyboard.press("Escape")

  // edits converge in both directions (driven through the WebMCP tools)
  await a.evaluate(() => window.__mcpTools.update_form.execute({ heightMm: 142 }))
  await b.waitForFunction(() => window.location.search.includes("height=142"), null, { timeout: 10000 })
  check("A → B: height edit lands on B", true)
  await b.evaluate(() => window.__mcpTools.set_clay.execute({ shrinkagePct: 9 }))
  await a.waitForFunction(() => window.location.search.includes("shrinkage=9"), null, { timeout: 10000 })
  check("B → A: clay edit lands on A", true)

  // the code was single-use
  const again = await fetch(`${BASE}/api/pair/claim`, {
    method: "POST",
    body: JSON.stringify({ code }),
  })
  check("the code burned on use", again.status === 404)

  // unpair stops the flow
  await b.click('button[aria-label="Pair a device"]')
  await b.click("text=Unpair this device")
  await a.evaluate(() => window.__mcpTools.update_form.execute({ heightMm: 200 }))
  await a.waitForFunction(() => window.location.search.includes("height=200"), null, { timeout: 10000 })
  await new Promise((r) => setTimeout(r, 1500))
  check(
    "unpaired B no longer follows",
    !(await b.evaluate(() => window.location.search)).includes("height=200")
  )
} catch (e) {
  failures++
  console.log("FAIL  pairing e2e crashed —", e.message)
} finally {
  await browser.close()
  server.kill()
}
console.log(failures === 0 ? "\nPAIRING E2E: all checks passed" : `\nPAIRING E2E: ${failures} failure(s)`)
process.exit(failures === 0 ? 0 : 1)
