import { beforeEach, describe, expect, it } from "vitest"
import { DEFAULT_CLAY, PRESETS } from "@/lib/model/schemas"
import { parseShareParams } from "@/lib/model/shareLink"
import { useProjectStore } from "./useProjectStore"

const reset = () =>
  useProjectStore.setState({
    form: { ...PRESETS["classic-mug"] },
    clay: { ...DEFAULT_CLAY },
    paperSize: "A4",
  })

describe("updateForm type switching", () => {
  beforeEach(reset)

  it("flares the top when switching to tapered from a straight form", () => {
    const { updateForm } = useProjectStore.getState()
    const before = useProjectStore.getState().form
    expect(before.type).toBe("cylinder")
    expect(before.topDiameterMm).toBe(before.bottomDiameterMm)

    updateForm({ type: "tapered" })

    const form = useProjectStore.getState().form
    expect(form.type).toBe("tapered")
    expect(form.topDiameterMm).toBeGreaterThan(form.bottomDiameterMm)
    expect(form.topDiameterMm).toBe(
      Math.min(300, Math.round(before.bottomDiameterMm * 1.4))
    )
  })

  it("respects an explicit top diameter supplied with the switch", () => {
    const { updateForm } = useProjectStore.getState()
    updateForm({ type: "tapered", topDiameterMm: 60 })
    expect(useProjectStore.getState().form.topDiameterMm).toBe(60)
  })

  it("does not re-flare when already tapered", () => {
    const { updateForm } = useProjectStore.getState()
    updateForm({ type: "tapered" })
    updateForm({ topDiameterMm: 85 }) // potter narrows it back to straight-ish
    updateForm({ type: "tapered", heightMm: 120 })
    expect(useProjectStore.getState().form.topDiameterMm).toBe(85)
  })

  it("caps the auto-flare at the schema maximum", () => {
    const { updateForm } = useProjectStore.getState()
    updateForm({ bottomDiameterMm: 280 })
    updateForm({ type: "tapered" })
    expect(useProjectStore.getState().form.topDiameterMm).toBe(300)
  })

  it("keeps top mirroring bottom for non-tapered forms", () => {
    const { updateForm } = useProjectStore.getState()
    updateForm({ type: "tapered" })
    updateForm({ type: "faceted", facets: 3 })
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
    expect(form.type).toBe("tapered")
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
})
