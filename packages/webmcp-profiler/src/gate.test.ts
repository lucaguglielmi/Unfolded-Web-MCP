// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { maybeAttachProfiler, maybeAttachProfilerLazy, PERF_STORAGE_KEY } from "./attach"
import { resolveGate } from "./gate"
import type { Profiler } from "./index"

const setUrl = (search: string) => (window as unknown as { happyDOM: { setURL: (u: string) => void } }).happyDOM.setURL(`http://localhost/${search}`)

let attached: Profiler | null = null
afterEach(() => {
  attached?.detach()
  attached = null
  localStorage.clear()
  vi.restoreAllMocks()
})

describe("resolveGate", () => {
  it.each([
    ["?perf=1", "1"],
    ["?perf=on", "1"],
    ["?perf=true", "1"],
    ["?perf=overlay", "overlay"],
  ])("%s persists and opens", (search, stored) => {
    setUrl(search)
    expect(resolveGate()).toEqual({ mode: stored, rejected: null })
    expect(localStorage.getItem(PERF_STORAGE_KEY)).toBe(stored)
  })

  it.each(["?perf=0", "?perf=off", "?perf=false"])("%s clears and stays closed", (search) => {
    localStorage.setItem(PERF_STORAGE_KEY, "1")
    setUrl(search)
    expect(resolveGate()).toEqual({ mode: null, rejected: null })
    expect(localStorage.getItem(PERF_STORAGE_KEY)).toBeNull()
  })

  it("an unknown value is rejected, not persisted", () => {
    setUrl("?perf=banana")
    expect(resolveGate()).toEqual({ mode: null, rejected: "banana" })
    expect(localStorage.getItem(PERF_STORAGE_KEY)).toBeNull()
  })

  it("a persisted mode opens the gate on a later URL without the parameter", () => {
    setUrl("?perf=overlay")
    resolveGate()
    setUrl("?type=round&height=120")
    expect(resolveGate().mode).toBe("overlay")
  })

  it("honours a custom param and storage key", () => {
    setUrl("?trace=1")
    expect(resolveGate({ param: "trace", storageKey: "my:key" }).mode).toBe("1")
    expect(localStorage.getItem("my:key")).toBe("1")
    expect(localStorage.getItem(PERF_STORAGE_KEY)).toBeNull()
  })

  it("the URL opens the gate for this load even when storage is blocked", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage")
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked")
      },
    })
    try {
      setUrl("?perf=overlay")
      expect(resolveGate().mode).toBe("overlay")
      setUrl("?other=1")
      expect(resolveGate().mode).toBeNull()
    } finally {
      if (original) Object.defineProperty(window, "localStorage", original)
    }
  })

  it("allow() false keeps the gate shut and clears a persisted mode", () => {
    localStorage.setItem(PERF_STORAGE_KEY, "1")
    setUrl("?perf=1")
    expect(resolveGate({ allow: () => false }).mode).toBeNull()
    expect(localStorage.getItem(PERF_STORAGE_KEY)).toBeNull()
  })
})

describe("maybeAttachProfiler", () => {
  it("returns null when closed and the profiler when open, announcing the global name", () => {
    setUrl("?nothing=1")
    expect(maybeAttachProfiler()).toBeNull()
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined)
    setUrl("?perf=1")
    attached = maybeAttachProfiler({ relay: false, globalName: "__p" })
    expect(attached?.active).toBe(true)
    expect(String(info.mock.calls[0][0])).toContain("__p.help()")
    expect(String(info.mock.calls[0][0])).toContain("?perf=0")
  })

  it("forwards profiler configuration and honours announce: false and a function", () => {
    setUrl("?perf=1")
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined)
    attached = maybeAttachProfiler({ relay: false, buffer: 3, announce: false })
    expect(info).not.toHaveBeenCalled()
    attached!.detach()
    const custom = vi.fn()
    attached = maybeAttachProfiler({ relay: false, announce: custom })
    expect(custom).toHaveBeenCalledWith(attached)
  })

  it("warns once on an unknown value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    setUrl("?perf=banana")
    expect(maybeAttachProfiler()).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it("the lazy variant resolves to the same instance a sync call returns", async () => {
    setUrl("?perf=1")
    vi.spyOn(console, "info").mockImplementation(() => undefined)
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    attached = await maybeAttachProfilerLazy({ relay: false })
    expect(attached?.active).toBe(true)
    expect(maybeAttachProfiler({ relay: false })).toBe(attached)
  })
})
