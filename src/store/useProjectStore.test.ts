import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_CLAY, PRESETS } from "@/lib/model/schemas"
import { parseShareParams } from "@/lib/model/shareLink"
import { shallow } from "zustand/shallow"
import { describeTemplates } from "@/mcp/describe"
import { createProjectStore, useProjectStore, type ProjectStore } from "./useProjectStore"

/* Each test gets a fresh, isolated store with a controllable clock — no
   shared module state to reset. `clock.t` drives undo coalescing:
   advancing it past the window starts a new undo step. */
let store: ProjectStore
const clock = { t: 0 }
const nextUndoStep = () => {
  clock.t += 10_000
}
const reset = () => {
  clock.t = 0
  store = createProjectStore({ now: () => clock.t })
}

describe("updateForm type switching", () => {
  beforeEach(reset)

  it("flares the top when turning taper on from a straight form", () => {
    const { updateForm } = store.getState()
    const before = store.getState().form
    expect(before.tapered).toBe(false)
    expect(before.topDiameterMm).toBe(before.bottomDiameterMm)

    updateForm({ tapered: true })

    const form = store.getState().form
    expect(form.tapered).toBe(true)
    expect(form.topDiameterMm).toBeGreaterThan(form.bottomDiameterMm)
    expect(form.topDiameterMm).toBe(
      Math.min(300, Math.round(before.bottomDiameterMm * 1.4))
    )
  })

  it("respects an explicit top diameter supplied with the switch", () => {
    const { updateForm } = store.getState()
    updateForm({ tapered: true, topDiameterMm: 60 })
    expect(store.getState().form.topDiameterMm).toBe(60)
  })

  it("does not re-flare when already tapered", () => {
    const { updateForm } = store.getState()
    updateForm({ tapered: true })
    updateForm({ topDiameterMm: 85 }) // potter narrows it back to straight-ish
    updateForm({ tapered: true, heightMm: 120 })
    expect(store.getState().form.topDiameterMm).toBe(85)
  })

  it("understands the legacy type vocabulary from old agents and links", () => {
    const { updateForm } = store.getState()
    updateForm({ type: "tapered" } as never)
    let form = store.getState().form
    expect(form.type).toBe("round")
    expect(form.tapered).toBe(true)
    updateForm({ type: "cylinder" } as never)
    form = store.getState().form
    expect(form.type).toBe("round")
    expect(form.tapered).toBe(false)
  })

  it("supports tapered faceted forms — taper is its own axis", () => {
    const { updateForm } = store.getState()
    updateForm({ type: "faceted", facets: 5, tapered: true, topDiameterMm: 120 })
    const form = store.getState().form
    expect(form.type).toBe("faceted")
    expect(form.tapered).toBe(true)
    expect(form.topDiameterMm).toBe(120)
  })

  it("caps the auto-flare at the schema maximum", () => {
    const { updateForm } = store.getState()
    updateForm({ bottomDiameterMm: 280 })
    updateForm({ tapered: true })
    expect(store.getState().form.topDiameterMm).toBe(300)
  })

  it("keeps top mirroring bottom for straight forms", () => {
    const { updateForm } = store.getState()
    updateForm({ tapered: true })
    updateForm({ type: "faceted", facets: 3, tapered: false })
    const form = store.getState().form
    expect(form.topDiameterMm).toBe(form.bottomDiameterMm)
  })
})

describe("openModel (share links)", () => {
  beforeEach(reset)

  it("applies a full share link — form, clay, and paper", () => {
    store
      .getState()
      .openModel(
        parseShareParams("?type=tapered&height=600&bottom=300&top=100&shrinkage=14&wall=6&paper=letter")
      )
    const { form, clay, paperSize } = store.getState()
    expect(form.type).toBe("round")
    expect(form.tapered).toBe(true)
    expect(form.heightMm).toBe(600)
    expect(form.bottomDiameterMm).toBe(300)
    expect(form.topDiameterMm).toBe(100)
    expect(clay).toEqual({ shrinkagePct: 14, wallThicknessMm: 6 })
    expect(paperSize).toBe("Letter")
  })

  it("keeps current values for parameters missing from the link", () => {
    store.getState().openModel(parseShareParams("type=hexagon"))
    const { form, clay } = store.getState()
    expect(form.type).toBe("faceted")
    expect(form.facets).toBe(6)
    expect(form.heightMm).toBe(PRESETS["classic-mug"].heightMm)
    expect(clay).toEqual(DEFAULT_CLAY)
  })

  it("does nothing for a link with no usable parameters", () => {
    const before = store.getState().form
    store.getState().openModel(parseShareParams("utm_source=chat&foo=1"))
    expect(store.getState().form).toEqual(before)
  })

  it("applies the unit preference riding on a link", () => {
    store.getState().openModel(parseShareParams("type=hexagon&units=in"))
    expect(store.getState().unit).toBe("in")
  })
})

describe("display units", () => {
  beforeEach(reset)

  it("setUnit changes the preference without touching undo history", () => {
    store.getState().setUnit("in")
    expect(store.getState().unit).toBe("in")
    expect(store.getState().history).toHaveLength(0)
    expect(store.getState().undo()).toBe(false)
  })

  it("undo never reverts a unit switch made between edits", () => {
    const { updateForm, setUnit, undo } = store.getState()
    updateForm({ heightMm: 200 })
    setUnit("in")
    expect(undo()).toBe(true)
    expect(store.getState().unit).toBe("in")
  })

  it("describeTemplates renders its warnings in the preferred unit too", () => {
    // describeTemplates serializes the app singleton, so drive that one —
    // walls thicker than the base radius always warn, mentioning lengths
    const snapshot = useProjectStore.getState()
    try {
      useProjectStore.getState().updateForm({ bottomDiameterMm: 20 })
      useProjectStore.getState().setClay({ wallThicknessMm: 15 })
      useProjectStore.getState().setUnit("in")
      const joined = describeTemplates().warnings.join(" ")
      expect(joined).toContain(" in")
      expect(joined).not.toContain(" cm")
    } finally {
      useProjectStore.setState(snapshot)
    }
  })
})

describe("undo", () => {
  beforeEach(reset)

  it("reverts the most recent change", () => {
    const { updateForm, undo } = store.getState()
    updateForm({ heightMm: 200 })
    expect(store.getState().form.heightMm).toBe(200)
    expect(undo()).toBe(true)
    expect(store.getState().form.heightMm).toBe(PRESETS["classic-mug"].heightMm)
  })

  it("coalesces rapid changes (a slider drag) into one undo step", () => {
    const { updateForm, undo } = store.getState()
    updateForm({ heightMm: 150 })
    updateForm({ heightMm: 175 })
    updateForm({ heightMm: 200 }) // all within the coalescing window
    expect(store.getState().history).toHaveLength(1)
    expect(undo()).toBe(true)
    expect(store.getState().form.heightMm).toBe(PRESETS["classic-mug"].heightMm)
    expect(undo()).toBe(false)
  })

  it("keeps separate steps for separate edits", () => {
    const { updateForm, setClay, undo } = store.getState()
    updateForm({ heightMm: 200 })
    nextUndoStep()
    setClay({ shrinkagePct: 15 })
    expect(store.getState().history).toHaveLength(2)
    expect(undo()).toBe(true)
    expect(store.getState().clay.shrinkagePct).toBe(DEFAULT_CLAY.shrinkagePct)
    expect(store.getState().form.heightMm).toBe(200)
    expect(undo()).toBe(true)
    expect(store.getState().form.heightMm).toBe(PRESETS["classic-mug"].heightMm)
  })

  it("reverts a whole opened link as one step", () => {
    const { openModel, undo } = store.getState()
    openModel(parseShareParams("?type=hexagon&height=110&bottom=140&shrinkage=11&paper=letter"))
    expect(store.getState().history).toHaveLength(1)
    expect(undo()).toBe(true)
    const { form, clay, paperSize } = store.getState()
    expect(form).toEqual(PRESETS["classic-mug"])
    expect(clay).toEqual(DEFAULT_CLAY)
    expect(paperSize).toBe("A4")
  })

  it("returns false with nothing to undo, and no-op patches don't burn steps", () => {
    const { updateForm, setClay, undo } = store.getState()
    expect(undo()).toBe(false)
    updateForm({ heightMm: PRESETS["classic-mug"].heightMm })
    setClay({ shrinkagePct: DEFAULT_CLAY.shrinkagePct })
    expect(store.getState().history).toHaveLength(0)
  })
})

describe("redo", () => {
  beforeEach(reset)

  it("re-applies an undone change, round-tripping cleanly", () => {
    const { updateForm, undo, redo } = store.getState()
    updateForm({ heightMm: 200 })
    expect(undo()).toBe(true)
    expect(store.getState().form.heightMm).toBe(PRESETS["classic-mug"].heightMm)
    expect(redo()).toBe(true)
    expect(store.getState().form.heightMm).toBe(200)
    // and back again — undo still works after a redo
    expect(store.getState().undo()).toBe(true)
    expect(store.getState().form.heightMm).toBe(PRESETS["classic-mug"].heightMm)
  })

  it("walks multiple steps in order", () => {
    const { updateForm, setClay, undo, redo } = store.getState()
    updateForm({ heightMm: 200 })
    nextUndoStep()
    setClay({ shrinkagePct: 15 })
    expect(undo()).toBe(true)
    expect(undo()).toBe(true)
    expect(redo()).toBe(true)
    expect(store.getState().form.heightMm).toBe(200)
    expect(store.getState().clay.shrinkagePct).toBe(DEFAULT_CLAY.shrinkagePct)
    expect(redo()).toBe(true)
    expect(store.getState().clay.shrinkagePct).toBe(15)
    expect(redo()).toBe(false)
  })

  it("a new change clears the redo stack", () => {
    const { updateForm, undo, redo } = store.getState()
    updateForm({ heightMm: 200 })
    expect(undo()).toBe(true)
    nextUndoStep()
    updateForm({ heightMm: 300 })
    expect(store.getState().future).toHaveLength(0)
    expect(redo()).toBe(false)
    expect(store.getState().form.heightMm).toBe(300)
  })

  it("returns false when there is nothing to redo", () => {
    expect(store.getState().redo()).toBe(false)
  })
})

describe("export concurrency", () => {
  beforeEach(reset)

  it("counts overlapping exports instead of flipping a boolean", async () => {
    const resolvers: (() => void)[] = []
    const mocked = vi.fn(
      () =>
        new Promise<{ pages: number; cols: number; rows: number; paper: "A4" }>((resolve) => {
          resolvers.push(() => resolve({ pages: 2, cols: 1, rows: 1, paper: "A4" }))
        })
    )
    store = createProjectStore({
      loadPdfModule: async () => ({ exportTemplatesPdf: mocked }),
    })

    const { exportPdf } = store.getState()
    const first = exportPdf() // e.g. the human
    const second = exportPdf() // e.g. the agent, overlapping
    expect(store.getState().exportsInFlight).toBe(2)
    await vi.waitFor(() => expect(resolvers).toHaveLength(2))

    resolvers[0]()
    await first
    // the second export is still running — the UI must stay disabled
    expect(store.getState().exportsInFlight).toBe(1)

    resolvers[1]()
    await second
    expect(store.getState().exportsInFlight).toBe(0)
  })

  it("decrements on failure and rejects to the caller", async () => {
    store = createProjectStore({
      loadPdfModule: async () => ({
        exportTemplatesPdf: () => Promise.reject(new Error("printer on fire")),
      }),
    })
    await expect(store.getState().exportPdf()).rejects.toThrow("printer on fire")
    expect(store.getState().exportsInFlight).toBe(0)
  })
})

describe("design-slice subscriptions (persistence / URL sync)", () => {
  beforeEach(reset)

  it("agent-status churn never wakes a design-slice subscriber", () => {
    const spy = vi.fn()
    // the same selector + equality persistence and urlSync use
    store.subscribe((s) => [s.form, s.clay, s.paperSize, s.unit] as const, spy, {
      equalityFn: shallow,
    })
    store.getState().recordAgentCall("describe_project")
    store.getState().setAgentStatus("chatgpt")
    expect(spy).not.toHaveBeenCalled()
    store.getState().updateForm({ heightMm: 300 })
    expect(spy).toHaveBeenCalledTimes(1)
    store.getState().setUnit("in")
    expect(spy).toHaveBeenCalledTimes(2)
  })
})
