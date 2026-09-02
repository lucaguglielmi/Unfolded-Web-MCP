import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/*
 * A minimal browser: enough window/document for the watchdog to read the
 * scroll state, find the studio shell, and wire its triggers. Stubbed
 * before each import — the module keeps an `installed` flag, so every
 * test gets a fresh copy.
 */
type Listener = (event: { target?: unknown; type: string }) => void

interface FakeDom {
  win: Record<string, unknown> & { scrollTo: ReturnType<typeof vi.fn>; scrollY: number }
  doc: Record<string, unknown> & { activeElement: unknown }
  shell: { scrollTop: number; scrollLeft: number; matches: (s: string) => boolean } | null
  fire: (type: string, target?: unknown) => void
}

class FakeElement {
  tagName: string
  isContentEditable = false
  constructor(tagName: string) {
    this.tagName = tagName
  }
}

function makeDom({
  shell = true,
  scrollY = 0,
  shellScrollTop = 0,
  scrollHeight = 800,
  innerHeight = 800,
  typing = false,
}: {
  shell?: boolean
  scrollY?: number
  shellScrollTop?: number
  scrollHeight?: number
  innerHeight?: number
  typing?: boolean
} = {}): FakeDom {
  const listeners = new Map<string, Listener[]>()
  const on = (type: string, fn: Listener) => {
    listeners.set(type, [...(listeners.get(type) ?? []), fn])
  }
  const shellEl = shell
    ? { scrollTop: shellScrollTop, scrollLeft: 0, matches: (s: string) => s === "[data-app-shell]" }
    : null
  const doc = {
    documentElement: { scrollTop: 0, scrollHeight },
    activeElement: typing ? new FakeElement("INPUT") : null,
    visibilityState: "visible",
    querySelector: (s: string) => (s === "[data-app-shell]" ? shellEl : null),
    addEventListener: on,
  }
  const win = {
    scrollY,
    innerHeight,
    scrollTo: vi.fn(),
    visualViewport: { pageTop: 0, addEventListener: on },
    addEventListener: on,
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>),
  }
  return {
    win,
    doc,
    shell: shellEl,
    fire: (type, target = doc) => {
      for (const fn of listeners.get(type) ?? []) fn({ type, target })
    },
  }
}

async function load(dom: FakeDom) {
  vi.stubGlobal("window", dom.win)
  vi.stubGlobal("document", dom.doc)
  vi.stubGlobal("HTMLElement", FakeElement)
  vi.stubGlobal("Element", Object)
  vi.resetModules()
  return import("./scrollUnstick")
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("unstick", () => {
  it("snaps a displaced studio document back to the top", async () => {
    const dom = makeDom({ scrollY: 120 })
    const { unstick } = await load(dom)
    expect(unstick()).toBe(true)
    expect(dom.win.scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it("resets a shell that was scrolled by a focus reveal", async () => {
    const dom = makeDom({ shellScrollTop: 64 })
    const { unstick } = await load(dom)
    expect(unstick()).toBe(true)
    expect(dom.shell?.scrollTop).toBe(0)
    expect(dom.win.scrollTo).not.toHaveBeenCalled()
  })

  it("acts on the studio route even when the document reports itself taller than the viewport", async () => {
    // a phone mid-keyboard-animation can report a transient extra height;
    // the shell's presence, not the height test, decides on this route
    const dom = makeDom({ scrollY: 200, scrollHeight: 1100, innerHeight: 800 })
    const { unstick } = await load(dom)
    expect(unstick()).toBe(true)
    expect(dom.win.scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it("leaves an explainer page's legitimate scroll alone", async () => {
    const dom = makeDom({ shell: false, scrollY: 400, scrollHeight: 3000, innerHeight: 800 })
    const { unstick } = await load(dom)
    expect(unstick()).toBe(false)
    expect(dom.win.scrollTo).not.toHaveBeenCalled()
  })

  it("still unsticks a non-studio page whose content fits the viewport", async () => {
    const dom = makeDom({ shell: false, scrollY: 30, scrollHeight: 800, innerHeight: 800 })
    const { unstick } = await load(dom)
    expect(unstick()).toBe(true)
  })

  it("stays out of the way while the person is typing", async () => {
    const dom = makeDom({ scrollY: 120, typing: true })
    const { unstick } = await load(dom)
    expect(unstick()).toBe(false)
    expect(dom.win.scrollTo).not.toHaveBeenCalled()
  })

  it("notifies settle subscribers on every pass, corrected or not", async () => {
    const dom = makeDom()
    const { unstick, subscribeSettled } = await load(dom)
    const listener = vi.fn()
    const off = subscribeSettled(listener)
    unstick()
    expect(listener).toHaveBeenCalledTimes(1)
    off()
    unstick()
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe("installScrollUnstick", () => {
  it("reacts to a document scroll on the studio route, in two settle passes", async () => {
    const dom = makeDom()
    const { installScrollUnstick } = await load(dom)
    installScrollUnstick()
    dom.win.scrollY = 150 // the displacement lands...
    dom.fire("scroll", dom.doc) // ...and is a scroll of the document
    expect(dom.win.scrollTo).not.toHaveBeenCalled() // never mid-animation
    vi.advanceTimersByTime(260)
    expect(dom.win.scrollTo).toHaveBeenCalledTimes(1)
    dom.win.scrollY = 90 // the animation's tail displaced it again
    vi.advanceTimersByTime(600)
    expect(dom.win.scrollTo).toHaveBeenCalledTimes(2)
  })

  it("ignores the settings panel scrolling itself", async () => {
    const dom = makeDom({ scrollY: 0 })
    const { installScrollUnstick } = await load(dom)
    installScrollUnstick()
    const panel = { matches: () => false }
    dom.fire("scroll", panel)
    dom.win.scrollY = 150
    vi.advanceTimersByTime(1000)
    expect(dom.win.scrollTo).not.toHaveBeenCalled()
  })

  it("waits for the keyboard to close: a nudge while typing is undone on focusout", async () => {
    const dom = makeDom({ scrollY: 180, typing: true })
    const { installScrollUnstick } = await load(dom)
    installScrollUnstick()
    dom.fire("scroll", dom.doc)
    vi.advanceTimersByTime(1000)
    expect(dom.win.scrollTo).not.toHaveBeenCalled()
    dom.doc.activeElement = null
    dom.fire("focusout")
    vi.advanceTimersByTime(260)
    expect(dom.win.scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it("re-checks on window resize and orientation change", async () => {
    const dom = makeDom({ scrollY: 40 })
    const { installScrollUnstick } = await load(dom)
    installScrollUnstick()
    dom.fire("orientationchange")
    vi.advanceTimersByTime(260)
    expect(dom.win.scrollTo).toHaveBeenCalledTimes(1)
    dom.fire("resize")
    vi.advanceTimersByTime(260)
    expect(dom.win.scrollTo).toHaveBeenCalledTimes(2)
  })
})
