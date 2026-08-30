import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_CLAY, PRESETS } from "@/lib/model/schemas"
import { parseShareParams } from "@/lib/model/shareLink"
import { _resetHistoryCoalescing, _setPdfModuleForTests, useProjectStore } from "./useProjectStore"

const reset = () => {
  useProjectStore.setState({
    form: { ...PRESETS["classic-mug"] },
    clay: { ...DEFAULT_CLAY },
    paperSize: "A4",
    history: [],
    future: [],
    exportsInFlight: 0,
    unit: "cm",
  })
  _resetHistoryCoalescing()
}

describe("updateForm type switching", () => {
  beforeEach(reset)

  it("flares the top when turning taper on from a straight form", () => {
    const { updateForm } = useProjectStore.getState()
    const before = useProjectStore.getState().form
    expect(before.tapered).toBe(false)
    expect(before.topDiameterMm).toBe(before.bottomDiameterMm)

    updateForm({ tapered: true })

    const form = useProjectStore.getState().form
    expect(form.tapered).toBe(true)
    expect(form.topDiameterMm).toBeGreaterThan(form.bottomDiameterMm)
    expect(form.topDiameterMm).toBe(
      Math.min(300, Math.round(before.bottomDiameterMm * 1.4))
    )
  })

  it("respects an explicit top diameter supplied with the switch", () => {
    const { updateForm } = useProjectStore.getState()
    updateForm({ tapered: true, topDiameterMm: 60 })
    expect(useProjectStore.getState().form.topDiameterMm).toBe(60)
  })

  it("does not re-flare when already tapered", () => {
    const { updateForm } = useProjectStore.getState()
    updateForm({ tapered: true })
    updateForm({ topDiameterMm: 85 }) // potter narrows it back to straight-ish
    updateForm({ tapered: true, heightMm: 120 })
    expect(useProjectStore.getState().form.topDiameterMm).toBe(85)
  })

  it("understands the legacy type vocabulary from old agents and links", () => {
    const { updateForm } = useProjectStore.getState()
    updateForm({ type: "tapered" } as never)
    let form = useProjectStore.getState().form
    expect(form.type).toBe("round")
    expect(form.tapered).toBe(true)
    updateForm({ type: "cylinder" } as never)
    form = useProjectStore.getState().form
    expect(form.type).toBe("round")
    expect(form.tapered).toBe(false)
  })

  it("supports tapered faceted forms — taper is its own axis", () => {
    const { updateForm } = useProjectStore.getState()
    updateForm({ type: "faceted", facets: 5, tapered: true, topDiameterMm: 120 })
    const form = useProjectStore.getState().form
    expect(form.type).toBe("faceted")
    expect(form.tapered).toBe(true)
    expect(form.topDiameterMm).toBe(120)
  })

  it("caps the auto-flare at the schema maximum", () => {
    const { updateForm } = useProjectStore.getState()
    updateForm({ bottomDiameterMm: 280 })
    updateForm({ tapered: true })
    expect(useProjectStore.getState().form.topDiameterMm).toBe(300)
  })

  it("keeps top mirroring bottom for straight forms", () => {
    const { updateForm } = useProjectStore.getState()
    updateForm({ tapered: true })
    updateForm({ type: "faceted", facets: 3, tapered: false })
    const form = useProjectStore.getState().form
    expect(form.topDiameterMm).toBe(form.bottomDiameterMm)
  })
})

describe("openModel (share links)", () => {
  beforeEach(reset)

  it("applies a full share link — form, clay, and paper", () => {
    useProjectStore
      .getState()
      .openModel(
        parseShareParams("?type=tapered&height=600&bottom=300&top=100&shrinkage=14&wall=6&paper=letter")
      )
    const { form, clay, paperSize } = useProjectStore.getState()
    expect(form.type).toBe("round")
    expect(form.tapered).toBe(true)
    expect(form.heightMm).toBe(600)
    expect(form.bottomDiameterMm).toBe(300)
    expect(form.topDiameterMm).toBe(100)
    expect(clay).toEqual({ shrinkagePct: 14, wallThicknessMm: 6 })
    expect(paperSize).toBe("Letter")
  })

  it("keeps current values for parameters missing from the link", () => {
    useProjectStore.getState().openModel(parseShareParams("type=hexagon"))
    const { form, clay } = useProjectStore.getState()
    expect(form.type).toBe("faceted")
    expect(form.facets).toBe(6)
    expect(form.heightMm).toBe(PRESETS["classic-mug"].heightMm)
    expect(clay).toEqual(DEFAULT_CLAY)
  })

  it("does nothing for a link with no usable parameters", () => {
    const before = useProjectStore.getState().form
    useProjectStore.getState().openModel(parseShareParams("utm_source=chat&foo=1"))
    expect(useProjectStore.getState().form).toEqual(before)
  })

  it("applies the unit preference riding on a link", () => {
    useProjectStore.getState().openModel(parseShareParams("type=hexagon&units=in"))
    expect(useProjectStore.getState().unit).toBe("in")
  })
})

describe("display units", () => {
  beforeEach(reset)

  it("setUnit changes the preference without touching undo history", () => {
    useProjectStore.getState().setUnit("in")
    expect(useProjectStore.getState().unit).toBe("in")
    expect(useProjectStore.getState().history).toHaveLength(0)
    expect(useProjectStore.getState().undo()).toBe(false)
  })

  it("undo never reverts a unit switch made between edits", () => {
    const { updateForm, setUnit, undo } = useProjectStore.getState()
    updateForm({ heightMm: 200 })
    setUnit("in")
    expect(undo()).toBe(true)
    expect(useProjectStore.getState().unit).toBe("in")
  })
})

describe("undo", () => {
  beforeEach(reset)

  it("reverts the most recent change", () => {
    const { updateForm, undo } = useProjectStore.getState()
    updateForm({ heightMm: 200 })
    expect(useProjectStore.getState().form.heightMm).toBe(200)
    expect(undo()).toBe(true)
    expect(useProjectStore.getState().form.heightMm).toBe(PRESETS["classic-mug"].heightMm)
  })

  it("coalesces rapid changes (a slider drag) into one undo step", () => {
    const { updateForm, undo } = useProjectStore.getState()
    updateForm({ heightMm: 150 })
    updateForm({ heightMm: 175 })
    updateForm({ heightMm: 200 }) // all within the coalescing window
    expect(useProjectStore.getState().history).toHaveLength(1)
    expect(undo()).toBe(true)
    expect(useProjectStore.getState().form.heightMm).toBe(PRESETS["classic-mug"].heightMm)
    expect(undo()).toBe(false)
  })

  it("keeps separate steps for separate edits", () => {
    const { updateForm, setClay, undo } = useProjectStore.getState()
    updateForm({ heightMm: 200 })
    _resetHistoryCoalescing()
    setClay({ shrinkagePct: 15 })
    expect(useProjectStore.getState().history).toHaveLength(2)
    expect(undo()).toBe(true)
    expect(useProjectStore.getState().clay.shrinkagePct).toBe(DEFAULT_CLAY.shrinkagePct)
    expect(useProjectStore.getState().form.heightMm).toBe(200)
    expect(undo()).toBe(true)
    expect(useProjectStore.getState().form.heightMm).toBe(PRESETS["classic-mug"].heightMm)
  })

  it("reverts a whole opened link as one step", () => {
    const { openModel, undo } = useProjectStore.getState()
    openModel(parseShareParams("?type=hexagon&height=110&bottom=140&shrinkage=11&paper=letter"))
    expect(useProjectStore.getState().history).toHaveLength(1)
    expect(undo()).toBe(true)
    const { form, clay, paperSize } = useProjectStore.getState()
    expect(form).toEqual(PRESETS["classic-mug"])
    expect(clay).toEqual(DEFAULT_CLAY)
    expect(paperSize).toBe("A4")
  })

  it("returns false with nothing to undo, and no-op patches don't burn steps", () => {
    const { updateForm, setClay, undo } = useProjectStore.getState()
    expect(undo()).toBe(false)
    updateForm({ heightMm: PRESETS["classic-mug"].heightMm })
    setClay({ shrinkagePct: DEFAULT_CLAY.shrinkagePct })
    expect(useProjectStore.getState().history).toHaveLength(0)
  })
})

describe("redo", () => {
  beforeEach(reset)

  it("re-applies an undone change, round-tripping cleanly", () => {
    const { updateForm, undo, redo } = useProjectStore.getState()
    updateForm({ heightMm: 200 })
    expect(undo()).toBe(true)
    expect(useProjectStore.getState().form.heightMm).toBe(PRESETS["classic-mug"].heightMm)
    expect(redo()).toBe(true)
    expect(useProjectStore.getState().form.heightMm).toBe(200)
    // and back again — undo still works after a redo
    expect(useProjectStore.getState().undo()).toBe(true)
    expect(useProjectStore.getState().form.heightMm).toBe(PRESETS["classic-mug"].heightMm)
  })

  it("walks multiple steps in order", () => {
    const { updateForm, setClay, undo, redo } = useProjectStore.getState()
    updateForm({ heightMm: 200 })
    _resetHistoryCoalescing()
    setClay({ shrinkagePct: 15 })
    expect(undo()).toBe(true)
    expect(undo()).toBe(true)
    expect(redo()).toBe(true)
    expect(useProjectStore.getState().form.heightMm).toBe(200)
    expect(useProjectStore.getState().clay.shrinkagePct).toBe(DEFAULT_CLAY.shrinkagePct)
    expect(redo()).toBe(true)
    expect(useProjectStore.getState().clay.shrinkagePct).toBe(15)
    expect(redo()).toBe(false)
  })

  it("a new change clears the redo stack", () => {
    const { updateForm, undo, redo } = useProjectStore.getState()
    updateForm({ heightMm: 200 })
    expect(undo()).toBe(true)
    _resetHistoryCoalescing()
    updateForm({ heightMm: 300 })
    expect(useProjectStore.getState().future).toHaveLength(0)
    expect(redo()).toBe(false)
    expect(useProjectStore.getState().form.heightMm).toBe(300)
  })

  it("returns false when there is nothing to redo", () => {
    expect(useProjectStore.getState().redo()).toBe(false)
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
    _setPdfModuleForTests(async () => ({ exportTemplatesPdf: mocked }))

    const { exportPdf } = useProjectStore.getState()
    const first = exportPdf() // e.g. the human
    const second = exportPdf() // e.g. the agent, overlapping
    expect(useProjectStore.getState().exportsInFlight).toBe(2)
    await vi.waitFor(() => expect(resolvers).toHaveLength(2))

    resolvers[0]()
    await first
    // the second export is still running — the UI must stay disabled
    expect(useProjectStore.getState().exportsInFlight).toBe(1)

    resolvers[1]()
    await second
    expect(useProjectStore.getState().exportsInFlight).toBe(0)
  })

  it("decrements on failure and rejects to the caller", async () => {
    _setPdfModuleForTests(async () => ({
      exportTemplatesPdf: () => Promise.reject(new Error("printer on fire")),
    }))
    await expect(useProjectStore.getState().exportPdf()).rejects.toThrow("printer on fire")
    expect(useProjectStore.getState().exportsInFlight).toBe(0)
  })
})
