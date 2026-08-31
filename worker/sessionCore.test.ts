import { describe, expect, it } from "vitest"
import { DEFAULT_CLAY, PRESETS } from "../src/lib/model/schemas"
import { SessionCore } from "./sessionCore"

const fullSlice = (form = PRESETS["tumbler"]) => ({
  form,
  clay: { ...DEFAULT_CLAY, shrinkagePct: 14 },
  paperSize: "Letter",
  unit: "in",
})

describe("SessionCore bootstrap", () => {
  it("adopts the first client's full design (eager creation)", () => {
    const core = new SessionCore()
    expect(core.bootstrap(fullSlice())).toBe(true)
    expect(core.state.form.name).toBe("Tapered tumbler")
    expect(core.state.clay.shrinkagePct).toBe(14)
    expect(core.state.paperSize).toBe("Letter")
    expect(core.state.unit).toBe("in")
    expect(core.version).toBe(0)
  })

  it("is a no-op once initialized — the session's state is canonical", () => {
    const core = new SessionCore()
    core.bootstrap(fullSlice())
    expect(core.bootstrap(fullSlice(PRESETS["bud-vase"]))).toBe(false)
    expect(core.state.form.name).toBe("Tapered tumbler")
  })

  it("keeps defaults for a partial or out-of-contract bootstrap", () => {
    const core = new SessionCore()
    expect(core.bootstrap({ form: { heightMm: 120 } })).toBe(false)
    expect(core.state.form.name).toBe("Classic mug")
    expect(core.initialized).toBe(true) // still marks first contact
  })

  it("round-trips through a snapshot (hibernation)", () => {
    const core = new SessionCore()
    core.bootstrap(fullSlice())
    core.apply({ form: { heightMm: 150 } })
    const revived = new SessionCore(core.snapshot())
    expect(revived.state.form.heightMm).toBe(150)
    expect(revived.version).toBe(1)
    expect(revived.bootstrap(fullSlice(PRESETS["bud-vase"]))).toBe(false)
  })
})

describe("SessionCore apply", () => {
  it("merges a field patch, bumps the version, echoes sanitized patches", () => {
    const core = new SessionCore()
    core.bootstrap(fullSlice())
    const result = core.apply({ form: { heightMm: 150 }, junk: true })
    expect(result).toEqual({ ok: true, patches: { form: { heightMm: 150 } }, version: 1 })
    expect(core.state.form.heightMm).toBe(150)
  })

  it("applies the same normalization the store does (taper flare)", () => {
    const core = new SessionCore()
    core.bootstrap({ ...fullSlice(PRESETS["classic-mug"]) })
    const result = core.apply({ form: { tapered: true } })
    expect(result.ok).toBe(true)
    // same rule as applyFormPatch: flare to 1.4x bottom, capped at 300
    expect(core.state.form.topDiameterMm).toBe(
      Math.min(300, Math.round(core.state.form.bottomDiameterMm * 1.4))
    )
  })

  it("rejects out-of-contract values and leaves state untouched", () => {
    const core = new SessionCore()
    core.bootstrap(fullSlice())
    const before = { ...core.state.form }
    const result = core.apply({ form: { heightMm: 5000 } })
    expect(result.ok).toBe(false)
    expect(core.state.form).toEqual(before)
    expect(core.version).toBe(0)
  })

  it("rejects patches with no recognizable fields", () => {
    const core = new SessionCore()
    expect(core.apply({ nonsense: 1 }).ok).toBe(false)
    expect(core.apply("garbage").ok).toBe(false)
    expect(core.version).toBe(0)
  })
})
