/**
 * Full-stack pairing e2e: the built app served by `wrangler dev` (assets +
 * Durable Objects), two real Chromium contexts. Context A mints a code in
 * the Pair dialog; context B enters it, adopts A's design, and edits flow
 * both ways — asserted through the address bar, which live-tracks the
 * design. Run with `npm run e2e:pairing` after `npm run build`.
 */
import { existsSync } from "node:fs"
import { chromium } from "playwright"
import { startWrangler } from "./wranglerDev.mjs"

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

if (!existsSync("dist/index.html")) {
  console.log("FAIL  dist/ is missing — run `npm run build` first")
  process.exit(1)
}
// Every context here shares one IP, and the suite's claims exhaust the
// Worker's default budget of 10 per IP per minute (worker/pairingCore.ts) —
// a throttled claim would read as "the link didn't pair". So this run, and
// only this run, raises the limit through the dev-only var instead of
// waiting the window out. Fails fast on a busy port or a wrangler that
// never comes up.
const server = await startWrangler({
  port: PORT,
  extraArgs: ["--var", "PAIR_CLAIMS_PER_IP_PER_MINUTE:1000"],
  ready: (res) => res.ok,
}).catch((e) => {
  console.log(`FAIL  ${e.message}`)
  process.exit(1)
})

// same simulated WebMCP host as e2e/run.mjs — gives us __unfoldedTools to
// drive edits without reaching into React internals
const mcpHostInit = () => {
  window.__mcpTools = {}
  // async fake host, mirroring e2e/run.mjs (spec 6.1)
  document.modelContext = {
    registerTool: (t, opts) =>
      new Promise((resolve) => {
        setTimeout(() => {
          if (opts?.signal?.aborted) return resolve()
          window.__mcpTools[t.name] = t
          resolve()
        }, 2)
      }),
  }
}

// The Continue dialog lives behind the header's connection hub (the
// two-dot button) — open the hub panel, then its Continue action.
const openContinue = async (page) => {
  await page.click("[data-connection-hub]")
  await page.click('button[aria-label="Continue on another screen"]')
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

  // A mints a code in the Continue dialog (behind the code toggle)
  await openContinue(a)
  await a.click('button:text-is("or use a code")')
  await a.click("text=Create a code to read aloud")
  const codeText = await a.textContent("code.font-mono", { timeout: 15000 })
  const code = (codeText ?? "").replace(/[^A-Z2-9]/g, "")
  check("A mints a 6-glyph code in the dialog", /^[A-HJ-NP-Z2-9]{6}$/.test(code), codeText ?? "none")

  // B enters it and follows A's session
  await openContinue(b)
  await b.click('button:text-is("or use a code")')
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
  check(
    "the connection hub shows the live device count",
    (await a.textContent("[data-connection-hub]").catch(() => ""))?.includes("2 devices") ?? false
  )
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
  await openContinue(b)
  await b.click("text=Unpair this device")
  await a.evaluate(() => window.__mcpTools.update_form.execute({ heightMm: 200 }))
  await a.waitForFunction(() => window.location.search.includes("height=200"), null, { timeout: 10000 })
  await new Promise((r) => setTimeout(r, 1500))
  check(
    "unpaired B no longer follows",
    !(await b.evaluate(() => window.location.search)).includes("height=200")
  )

  // ---- the agent-side tools (spec flows A and B) ----
  // flow B: the work lives on B ("the phone") — its agent mints via
  // start_pairing, and A joins B's session by entering the code
  await b.keyboard.press("Escape")
  await b.evaluate(() => window.__mcpTools.update_form.execute({ name: "Flow B planter" }))
  const mintResult = await b.evaluate(async () => {
    const r = await window.__mcpTools.start_pairing.execute({})
    return r.content.find((c) => c.type === "text")?.text ?? ""
  })
  const toolCode = (mintResult.match(/[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}/) ?? [""])[0]
  check("start_pairing returns a spoken-friendly code", toolCode.length === 7, mintResult.slice(0, 120))
  await openContinue(a)
  await a.click('button:text-is("or use a code")')
  await a.fill('input[aria-label="Pairing code from your other device"]', toolCode)
  await a.click('button:text-is("Join")')
  await a.waitForFunction(() => window.location.search.includes("Flow"), null, { timeout: 10000 })
  check("flow B: desktop adopts the phone's design via the tool-minted code", true)
  await a.keyboard.press("Escape")

  // flow A: A mints in the dialog, B's agent joins with join_session
  await openContinue(a)
  await a.click('button:text-is("or use a code")')
  await a.click("text=Create a code to read aloud")
  const codeText2 = await a.textContent("code.font-mono", { timeout: 15000 })
  const code2 = (codeText2 ?? "").replace(/[^A-Z2-9]/g, "")
  const joinResult = await b.evaluate(async ([c]) => {
    const r = await window.__mcpTools.join_session.execute({ code: c })
    return { isError: r.isError ?? false, text: r.content.find((x) => x.type === "text")?.text ?? "" }
  }, [code2.toLowerCase()]) // case-insensitive on purpose
  check(
    "flow A: join_session joins and reports the peers",
    !joinResult.isError && joinResult.text.includes("Joined live session"),
    joinResult.text.slice(0, 120)
  )

  // a burned/garbage code comes back as a graceful isError
  const badJoin = await b.evaluate(async ([c]) => {
    const r = await window.__mcpTools.join_session.execute({ code: c })
    return { isError: r.isError ?? false, text: r.content.find((x) => x.type === "text")?.text ?? "" }
  }, [code2])
  check(
    "join_session: burned code is a graceful isError",
    badJoin.isError && badJoin.text.includes("used once"),
    badJoin.text.slice(0, 120)
  )

  // offline resilience: B drops off the network, A keeps editing, B's own
  // offline edit survives the reconnect and both converge
  await ctxB.setOffline(true)
  await a.evaluate(() => window.__mcpTools.update_form.execute({ heightMm: 188 }))
  await b.evaluate(() => window.__mcpTools.set_clay.execute({ wallThicknessMm: 8 }))
  await new Promise((r) => setTimeout(r, 1200))
  check(
    "offline B hasn't seen A's edit yet",
    !(await b.evaluate(() => window.location.search)).includes("height=188")
  )
  await ctxB.setOffline(false)
  await b.waitForFunction(() => window.location.search.includes("height=188"), null, { timeout: 20000 })
  await a.waitForFunction(() => window.location.search.includes("wall=8"), null, { timeout: 20000 })
  check("both converge after B comes back online (offline edits included)", true)

  // ---- v3: join-token flows ----
  // the Continue dialog's link carries a single-use token; opening it on a
  // fresh device pairs with zero typing
  const ctxD = await browser.newContext()
  const d = await ctxD.newPage()
  await a.keyboard.press("Escape")
  await openContinue(a)
  // A is already paired, so the dialog shows the honest success panel
  // instead of a spent invitation — inviting a third screen is an
  // explicit click now
  const anotherScreen = a.locator('button:text-is("Invite another screen")')
  await anotherScreen.waitFor({ state: "visible", timeout: 5000 }).catch(() => {})
  if (await anotherScreen.isVisible()) await anotherScreen.click()
  await a.waitForFunction(
    () => (document.querySelector("[data-continue-url]")?.getAttribute("data-continue-url") ?? "").includes("join="),
    null,
    { timeout: 15000 }
  )
  const continueUrl = await a.getAttribute("[data-continue-url]", "data-continue-url")
  await a.keyboard.press("Escape")
  await d.goto(continueUrl)
  await d.waitForFunction(() => !window.location.search.includes("join="), null, { timeout: 10000 })
  check("continue link: the token is stripped from the address bar", true)
  await a.evaluate(() => window.__mcpTools.update_form.execute({ heightMm: 222 }))
  await d.waitForFunction(() => window.location.search.includes("height=222"), null, { timeout: 15000 })
  check("continue link: the opening device follows live, no code typed", true)

  // the same link a second time is burned — the design opens, nothing joins
  const ctxE = await browser.newContext()
  const e2 = await ctxE.newPage()
  await e2.goto(continueUrl)
  await e2.waitForFunction(() => !window.location.search.includes("join="), null, { timeout: 10000 })
  await a.evaluate(() => window.__mcpTools.update_form.execute({ heightMm: 233 }))
  await d.waitForFunction(() => window.location.search.includes("height=233"), null, { timeout: 15000 })
  check(
    "continue link: second open is burned — no ghost follower",
    !(await e2.evaluate(() => window.location.search)).includes("height=233")
  )
  await ctxD.close()
  await ctxE.close()

  // the hub's "No agent here" section offers a paste-into-ChatGPT prompt
  // that carries quick instructions plus a live pairing code
  const ctxH = await browser.newContext()
  const h = await ctxH.newPage()
  await h.goto(`${BASE}/`)
  await h.evaluate(() => {
    window.__copiedPrompt = null
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (t) => {
          window.__copiedPrompt = t
          return Promise.resolve()
        },
      },
    })
  })
  await h.click("[data-connection-hub]")
  // the Open-in-ChatGPT link injects the same prompt via chatgpt.com/?q=
  await h.waitForFunction(
    () =>
      (document.querySelector("a[data-chatgpt-prompt]")?.getAttribute("href") ?? "").includes(
        "chatgpt.com/?q="
      ),
    null,
    { timeout: 15000 }
  )
  const chatHref = await h.getAttribute("a[data-chatgpt-prompt]", "href")
  const injected = decodeURIComponent(chatHref.split("?q=")[1] ?? "")
  check(
    "hub: Open-in-ChatGPT link injects the prompt with a pairing code",
    injected.includes("join_session") && /[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}/.test(injected),
    injected.slice(0, 140)
  )
  await h.click('button:has-text("Copy prompt")')
  await h.waitForFunction(() => typeof window.__copiedPrompt === "string", null, { timeout: 15000 })
  const copiedPrompt = await h.evaluate(() => window.__copiedPrompt)
  check(
    "hub: ChatGPT prompt carries instructions and a pairing code",
    copiedPrompt.includes("tryunfolded.com") &&
      copiedPrompt.includes("join_session") &&
      /[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}/.test(copiedPrompt),
    (copiedPrompt ?? "none").slice(0, 140)
  )
  // and the code in it is real: a second page joins with it
  const promptCode = (copiedPrompt.match(/[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}/) ?? [""])[0]
  const ctxI = await browser.newContext()
  const iPage = await ctxI.newPage()
  await iPage.addInitScript(mcpHostInit)
  await iPage.goto(`${BASE}/`)
  await iPage.waitForFunction(() => window.__mcpTools?.join_session, null, { timeout: 15000 })
  const promptJoin = await iPage.evaluate(async ([c]) => {
    const r = await window.__mcpTools.join_session.execute({ code: c })
    return { isError: r.isError ?? false, text: r.content.find((x) => x.type === "text")?.text ?? "" }
  }, [promptCode])
  check(
    "hub: the prompt's code pairs via join_session",
    !promptJoin.isError && promptJoin.text.includes("Joined live session"),
    promptJoin.text.slice(0, 120)
  )
  await ctxH.close()
  await ctxI.close()

  // live handoff (docs/live-handoff-link-spec.md): a tab driven by an
  // agent mints a single-use liveHandoffUrl ON DEMAND; state reads carry
  // only the permanent designUrl. Opening the handoff link makes the
  // visible tab a live follower of the hidden one — both ways.
  const ctxF = await browser.newContext()
  const f = await ctxF.newPage()
  await f.addInitScript(mcpHostInit)
  await f.goto(`${BASE}/?type=pentagon&height=90&bottom=110&name=Hidden%20browser`)
  await f.waitForFunction(() => window.__mcpTools?.create_live_handoff, null, { timeout: 15000 })
  const described = await f.evaluate(async () => {
    const r = await window.__mcpTools.describe_project.execute({})
    return JSON.parse(r.content.find((c) => c.type === "text")?.text ?? "{}")
  })
  check(
    "agent tab: describe_project carries a permanent designUrl and no token",
    typeof described.designUrl === "string" &&
      !described.designUrl.includes("join=") &&
      described.shareUrl === undefined &&
      described.liveHandoffTool === "create_live_handoff",
    JSON.stringify({ designUrl: described.designUrl, shareUrl: described.shareUrl }).slice(0, 160)
  )
  const handoff = await f.evaluate(async () => {
    const r = await window.__mcpTools.create_live_handoff.execute({})
    const text = r.content.find((c) => c.type === "text")?.text ?? ""
    return { isError: r.isError ?? false, ...(r.isError ? { text } : JSON.parse(text)) }
  })
  check(
    "agent tab: create_live_handoff mints via=chatgpt + a single-use join token",
    !handoff.isError &&
      handoff.liveHandoffUrl?.includes("via=chatgpt") &&
      handoff.liveHandoffUrl?.includes("join=") &&
      handoff.designUrl && !handoff.designUrl.includes("join=") &&
      handoff.singleUse === true,
    JSON.stringify(handoff).slice(0, 200)
  )
  const agentUrl = handoff.liveHandoffUrl ?? ""
  const ctxG = await browser.newContext()
  const g = await ctxG.newPage()
  await g.addInitScript(mcpHostInit) // a host in the visible tab stands in for the human's UI edit below
  await g.goto(agentUrl)
  await g.waitForFunction(() => !window.location.search.includes("join="), null, { timeout: 10000 })
  await f.evaluate(() => window.__mcpTools.set_clay.execute({ shrinkagePct: 7 }))
  await g.waitForFunction(() => window.location.search.includes("shrinkage=7"), null, { timeout: 15000 })
  check("agent tab: the visible tab follows the hidden browser live", true)
  // and the visible tab's edits reach the agent's next read (hardening spec 6.4)
  await g.waitForFunction(() => window.__mcpTools?.update_form, null, { timeout: 15000 })
  await g.evaluate(() => window.__mcpTools.update_form.execute({ heightMm: 171 }))
  await f.waitForFunction(() => window.location.search.includes("height=171"), null, { timeout: 15000 })
  const agentRead = await f.evaluate(async () => {
    const r = await window.__mcpTools.describe_project.execute({})
    return JSON.parse(r.content.find((c) => c.type === "text")?.text ?? "{}").form?.heightMm
  })
  check("agent tab: the visible tab's edit reaches the agent's next read", agentRead === 171, String(agentRead))
  // a burned handoff link opens the snapshot but does not pair
  const ctxJ = await browser.newContext()
  const j = await ctxJ.newPage()
  await j.goto(agentUrl)
  await j.waitForFunction(() => !window.location.search.includes("join="), null, { timeout: 10000 })
  await f.evaluate(() => window.__mcpTools.set_clay.execute({ wallThicknessMm: 9 }))
  await g.waitForFunction(() => window.location.search.includes("wall=9"), null, { timeout: 15000 })
  await new Promise((r) => setTimeout(r, 1200))
  const burnedSearch = await j.evaluate(() => window.location.search)
  check(
    "burned handoff link: opens the design snapshot it encodes but no longer follows",
    !burnedSearch.includes("wall=9") && burnedSearch.includes("name=Hidden"),
    burnedSearch.slice(0, 120)
  )
  await ctxJ.close()
  await ctxF.close()
  await ctxG.close()
} catch (e) {
  failures++
  console.log("FAIL  pairing e2e crashed —", e.message)
  console.log(server.log().slice(-2000))
} finally {
  await browser.close()
  await server.stop()
}
console.log(failures === 0 ? "\nPAIRING E2E: all checks passed" : `\nPAIRING E2E: ${failures} failure(s)`)
process.exit(failures === 0 ? 0 : 1)
