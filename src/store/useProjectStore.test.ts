import { beforeEach, describe, expect, it } from "vitest"
import { PRESETS } from "@/lib/model/schemas"
import { useProjectStore } from "./useProjectStore"

const reset = () =>
  useProjectStore.setState({ form: { ...PRESETS["classic-mug"] } })

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
