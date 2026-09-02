/**
 * Live-sync backend smoke suite: the REAL Durable Objects behind
 * `wrangler dev --local`, driven by two live WebSockets — bootstrap hello,
 * mint-over-WS / claim-over-HTTP, single-use burn, patch fan-out in both
 * directions, echo versioning, invalid-patch rejection, and routing
 * guards. Run with `npm run e2e:worker` (no build needed — wrangler
 * bundles the worker itself; the assets 404 is irrelevant here).
 */
import { startWrangler } from "./wranglerDev.mjs"

const PORT = 8788
const BASE = `http://localhost:${PORT}`
let failures = 0
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`)
  if (!ok) failures++
}

// fails fast on a busy port or a wrangler that never comes up (e2e/wranglerDev.mjs)
const server = await startWrangler({ port: PORT }).catch((e) => {
  console.log(`FAIL  ${e.message}`)
  process.exit(1)
})

const openSocket = (sid) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/api/session/${sid}/ws`)
    const inbox = []
    const waiters = []
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data)
      const i = waiters.findIndex((w) => w.kind === msg.kind)
      if (i >= 0) waiters.splice(i, 1)[0].resolve(msg)
      else inbox.push(msg)
    })
    ws.addEventListener("open", () =>
      resolve({
        ws,
        send: (m) => ws.send(JSON.stringify(m)),
        next: (kind, ms = 5000) =>
          new Promise((res, rej) => {
            const i = inbox.findIndex((m) => m.kind === kind)
            if (i >= 0) return res(inbox.splice(i, 1)[0])
            const w = { kind, resolve: res }
            waiters.push(w)
            setTimeout(() => rej(new Error(`timeout waiting for ${kind}`)), ms)
          }),
      })
    )
    ws.addEventListener("error", reject)
  })

try {
  const sid = crypto.randomUUID().replaceAll("-", "")
  const design = {
    form: { type: "round", tapered: true, name: "Smoke tumbler", heightMm: 130, topDiameterMm: 90, bottomDiameterMm: 65, facets: 4 },
    clay: { shrinkagePct: 13, wallThicknessMm: 5 },
    paperSize: "Letter",
    unit: "in",
  }

  // tab A: first contact bootstraps the eager session
  const a = await openSocket(sid)
  a.send({ kind: "hello", protocolVersion: 1, clientId: "tab-a", actor: "human", state: design })
  const welcomeA = await a.next("welcome")
  check("bootstrap: welcome carries the minting tab's design", welcomeA.state?.form?.name === "Smoke tumbler" && welcomeA.peers === 1)

  // mint over WS, claim over HTTP
  a.send({ kind: "mint_code" })
  const code = await a.next("code")
  check("mint: 6-glyph code with expiry", /^[A-HJ-NP-Z2-9]{6}$/.test(code.code ?? "") && code.expiresAt > Date.now(), JSON.stringify(code))
  const claim = await (await fetch(`${BASE}/api/pair/claim`, { method: "POST", body: JSON.stringify({ code: code.code }) })).json()
  check("claim: resolves to the session id", claim.ok === true && claim.sid === sid, JSON.stringify(claim))
  const again = await fetch(`${BASE}/api/pair/claim`, { method: "POST", body: JSON.stringify({ code: code.code }) })
  check("claim: single use — second claim is a uniform 404", again.status === 404)

  // tab B joins the claimed session and adopts its state
  const b = await openSocket(claim.sid)
  b.send({ kind: "hello", protocolVersion: 1, clientId: "tab-b", actor: "agent" })
  const welcomeB = await b.next("welcome")
  check("join: welcome carries session state to the claimer", welcomeB.state?.form?.name === "Smoke tumbler" && welcomeB.peers === 2)
  const presenceA = await a.next("presence")
  check("presence: tab A sees 2 devices", presenceA.peers === 2)

  // patch fan-out, both directions, echo included
  b.send({ kind: "patch", patchId: "p1", baseVersion: welcomeB.version, patches: { form: { heightMm: 150 } } })
  const patchAtA = await a.next("patch")
  check("fan-out: A gets B's patch with actor+version", patchAtA.patches?.form?.heightMm === 150 && patchAtA.actor === "agent" && patchAtA.version === welcomeB.version + 1)
  const echoAtB = await b.next("patch")
  check("echo: B gets its own patch back (version learning)", echoAtB.clientId === "tab-b")
  a.send({ kind: "patch", patchId: "p2", baseVersion: patchAtA.version, patches: { clay: { shrinkagePct: 11 } } })
  const patchAtB = await b.next("patch")
  check("fan-out: B gets A's patch", patchAtB.patches?.clay?.shrinkagePct === 11)

  // invalid patch → error to sender only, state intact
  b.send({ kind: "patch", patchId: "p3", baseVersion: 99, patches: { form: { heightMm: 5000 } } })
  const err = await b.next("error")
  check("validation: out-of-contract patch rejected", err.code === "invalid_patch")

  // a rejoin hello gets the current canonical state
  a.send({ kind: "hello", protocolVersion: 1, clientId: "tab-a", actor: "human" })
  const rewelcome = await a.next("welcome")
  check("re-hello: canonical state reflects both edits", rewelcome.state?.form?.heightMm === 150 && rewelcome.state?.clay?.shrinkagePct === 11)

  // bad sid shape and bad code are turned away
  check("routing: malformed sid rejected", (await fetch(`${BASE}/api/session/short/ws`)).status === 400)
  const badCode = await fetch(`${BASE}/api/pair/claim`, { method: "POST", body: JSON.stringify({ code: "000000" }) })
  check("claim: garbage code is a uniform 404", badCode.status === 404)

  a.ws.close()
  b.ws.close()
} catch (e) {
  failures++
  console.log("FAIL  smoke crashed —", e.message)
  console.log(server.log().slice(-2000))
} finally {
  await server.stop()
}
console.log(failures === 0 ? "\nWORKER SMOKE: all checks passed" : `\nWORKER SMOKE: ${failures} failure(s)`)
process.exit(failures === 0 ? 0 : 1)
