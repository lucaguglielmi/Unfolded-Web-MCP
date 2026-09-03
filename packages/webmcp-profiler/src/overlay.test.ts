// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { Collector, type RawSpan, type Span } from "./core/collector"
import { createOverlay, validRelayMessage, type Overlay } from "./overlay"
import type { ProfilerStatus } from "./index"

const raw = (over: Partial<RawSpan> = {}): RawSpan => ({
  tool: "demo", invokedAt: 100, settledAt: 105, wallMs: 5, blockingMs: 0, inputBytes: 10, resultBytes: 400,
  contentTypes: { text: 1 }, imageBytes: 0, estInputTokens: 3, estTextTokens: 100, estImageTokens: 0, estTokens: 103,
  isError: false, error: null, serializable: true, ...over,
})
const status = (): ProfilerStatus => ({
  phase: "tools-registered", message: "tools are wrapped; waiting for the first call", hostLocation: "document",
  hostFoundAt: 1, toolCount: 1, callCount: 0, lastCallAt: null, hints: [],
})
const wait = (ms = 320) => new Promise((r) => setTimeout(r, ms))
const shadowOf = () => document.documentElement.lastElementChild!.shadowRoot!

let overlay: Overlay | null = null
afterEach(() => {
  overlay?.destroy()
  overlay = null
})

describe("overlay", () => {
  it("shows the status message until spans exist, then the table and the ledger line", async () => {
    const c = new Collector()
    overlay = createOverlay(c, { status, channel: false })
    const shadow = shadowOf()
    expect(shadow.querySelector(".status")!.textContent).toContain("waiting for the first call")
    c.record(raw())
    await wait()
    expect(shadow.querySelector(".status")!.hasAttribute("hidden")).toBe(true)
    const cells = [...shadow.querySelectorAll("td")].map((td) => td.textContent)
    expect(cells[0]).toBe("demo")
    expect(cells[1]).toBe("1")
    expect(shadow.querySelector(".ledger")!.textContent).toContain("payloads")
    expect(shadow.querySelector(".ledger")!.getAttribute("aria-live")).toBe("polite")
  })

  it("renders tool names as text, never as markup", async () => {
    const c = new Collector()
    overlay = createOverlay(c, { status, channel: false })
    c.record(raw({ tool: "<img src=x onerror=alert(1)>" }))
    await wait()
    const shadow = shadowOf()
    expect(shadow.querySelector("img")).toBeNull()
    expect(shadow.querySelector("td")!.textContent).toBe("<img src=x onerror=alert(1)>")
  })

  it("updates only the rows that changed", async () => {
    const c = new Collector()
    overlay = createOverlay(c, { status, channel: false })
    c.record(raw({ tool: "a" }))
    c.record(raw({ tool: "b" }))
    await wait()
    const shadow = shadowOf()
    const rowA = shadow.querySelectorAll("tr")[1]
    c.record(raw({ tool: "b" }))
    await wait()
    expect(shadow.querySelectorAll("tr")[1]).toBe(rowA)
    expect(shadow.querySelectorAll("tr")[2].querySelectorAll("td")[1].textContent).toBe("2")
  })

  it("renders relayed sessions as their own tables and applies updates by id", async () => {
    const c = new Collector({ sessionId: "aaaaaaaa" })
    overlay = createOverlay(c, { status, channel: "webmcp-perf:overlay-test" })
    const sender = new BroadcastChannel("webmcp-perf:overlay-test")
    const remote = new Collector({ sessionId: "bbbbbbbb" })
    const span = remote.record(raw({ tool: "remote_tool" }))
    sender.postMessage({ kind: "span", span })
    await wait()
    const shadow = shadowOf()
    expect(shadow.querySelector(".remote")!.textContent).toBe("relayed · bbbbbbbb")
    expect([...shadow.querySelectorAll("td")].map((t) => t.textContent)).toContain("remote_tool")
    sender.postMessage({ kind: "update", sessionId: "bbbbbbbb", seq: 0, blockingMs: 40 })
    await wait()
    // malformed and foreign messages are dropped silently
    sender.postMessage({ kind: "span", span: { ...span, tool: "x".repeat(200) } })
    sender.postMessage({ kind: "span", span: { ...span, sessionId: "not-hex" } })
    sender.postMessage("garbage")
    await wait()
    expect(shadow.querySelectorAll(".remote")).toHaveLength(1)
    sender.close()
  })

  it("does not render while the tab is hidden, and catches up when visible", async () => {
    const c = new Collector()
    overlay = createOverlay(c, { status, channel: false })
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true })
    c.record(raw())
    await wait()
    const shadow = shadowOf()
    expect(shadow.querySelectorAll("td")).toHaveLength(0)
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true })
    document.dispatchEvent(new Event("visibilitychange"))
    expect(shadow.querySelectorAll("td").length).toBeGreaterThan(0)
  })

  it("toggle hides and shows; destroy removes the host", () => {
    const c = new Collector()
    overlay = createOverlay(c, { status, channel: false })
    const host = document.documentElement.lastElementChild as HTMLElement
    overlay.toggle()
    expect(host.hidden).toBe(true)
    overlay.toggle()
    expect(host.hidden).toBe(false)
    overlay.destroy()
    overlay = null
    expect(document.documentElement.contains(host)).toBe(false)
  })
})

describe("validRelayMessage", () => {
  const good: Span = { ...raw(), sessionId: "0123abcd", seq: 3, gapSincePrevCallMs: null, synthetic: false }
  it("accepts a well-formed span and update", () => {
    expect(validRelayMessage({ kind: "span", span: good })?.kind).toBe("span")
    expect(validRelayMessage({ kind: "update", sessionId: "0123abcd", seq: 1, blockingMs: 2 })?.kind).toBe("update")
  })
  it.each([
    ["no kind", { span: good }],
    ["bad session", { kind: "span", span: { ...good, sessionId: "zz" } }],
    ["negative seq", { kind: "span", span: { ...good, seq: -1 } }],
    ["long tool", { kind: "span", span: { ...good, tool: "x".repeat(129) } }],
    ["NaN bytes", { kind: "span", span: { ...good, resultBytes: Number.NaN } }],
    ["too many content types", { kind: "span", span: { ...good, contentTypes: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`t${i}`, 1])) } }],
    ["update without number", { kind: "update", sessionId: "0123abcd", seq: 1, blockingMs: "2" }],
    ["primitive", 42],
  ])("rejects %s", (_name, data) => {
    expect(validRelayMessage(data)).toBeNull()
  })
  it("drops unknown fields and caps error text", () => {
    const msg = validRelayMessage({ kind: "span", span: { ...good, extra: "x", error: "e".repeat(300) } })
    expect(msg?.kind).toBe("span")
    if (msg?.kind === "span") {
      expect("extra" in msg.span).toBe(false)
      expect(msg.span.error!.length).toBe(200)
    }
  })
})
