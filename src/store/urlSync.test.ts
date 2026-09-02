import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { useProjectStore } from "./useProjectStore"

/* A minimal window: the address bar (a real URL, so replaceState is checked
   the way the browser would), timers, and a blocked-looking localStorage
   for the modules urlSync pulls in. Stubbed before the import — syncClient
   reads window at module load. */
const url = new URL("https://unfolded.example.com/")
const win = {
  location: {
    get href() {
      return url.href
    },
    get pathname() {
      return url.pathname
    },
    get search() {
      return url.search
    },
    origin: url.origin,
  },
  history: {
    replaceState: (_state: unknown, _title: string, next: string) => {
      url.href = new URL(next, url.href).href
    },
  },
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clearTimeout: (t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>),
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
}

let sync: typeof import("./urlSync")

beforeAll(async () => {
  vi.stubGlobal("window", win)
  sync = await import("./urlSync")
  sync.startShareLinkSync()
})

afterAll(() => vi.unstubAllGlobals())

beforeEach(() => {
  vi.useFakeTimers()
  useProjectStore.getState().openModel({ form: { heightMm: 100 } })
  vi.runAllTimers()
})

describe("startShareLinkSync", () => {
  it("rewrites the address bar to the design after an edit", () => {
    url.href = "https://unfolded.example.com/?type=cylinder&height=100"
    useProjectStore.getState().updateForm({ heightMm: 120 })
    vi.runAllTimers()
    expect(url.pathname).toBe("/")
    expect(url.searchParams.get("height")).toBe("120")
    expect(url.searchParams.get("via")).toBeNull()
  })

  it("keeps the ?via=chatgpt provenance marker across rewrites", () => {
    url.href = "https://unfolded.example.com/?type=hexagon&height=100&via=chatgpt"
    useProjectStore.getState().updateForm({ heightMm: 130 })
    vi.runAllTimers()
    expect(url.searchParams.get("height")).toBe("130")
    expect(url.searchParams.get("via")).toBe("chatgpt")
    // …and keeps it on the next edit too, not just the first
    useProjectStore.getState().updateForm({ heightMm: 140 })
    vi.runAllTimers()
    expect(url.searchParams.get("height")).toBe("140")
    expect(url.searchParams.getAll("via")).toEqual(["chatgpt"])
  })

  it("never carries a ?join= token along — it is single-use", () => {
    // (boot strips it; a rewrite must not resurrect it either)
    url.href = "https://unfolded.example.com/?type=cylinder&height=100&join=abc&via=chatgpt"
    useProjectStore.getState().updateForm({ heightMm: 150 })
    vi.runAllTimers()
    expect(url.searchParams.get("join")).toBeNull()
    expect(url.searchParams.get("via")).toBe("chatgpt")
  })
})

describe("applyShareLinkFromLocation", () => {
  it("flags the tab as opened from ChatGPT and strips the join token", () => {
    url.href = "https://unfolded.example.com/?type=cylinder&height=160&via=chatgpt&join=abc"
    sync.applyShareLinkFromLocation()
    expect(useProjectStore.getState().form.heightMm).toBe(160)
    expect(useProjectStore.getState().agentStatus).toBe("chatgpt")
    expect(url.searchParams.get("join")).toBeNull()
    expect(url.searchParams.get("via")).toBe("chatgpt")
  })
})
