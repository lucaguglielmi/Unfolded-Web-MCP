import { describe, expect, it } from "vitest"
import { ZodError } from "zod"
import { applyClayPatch, applyFormPatch } from "./applyPatch"
import { DEFAULT_CLAY, PRESETS, type FormParams, type UpdateFormInput } from "./schemas"

/* applyFormPatch is the ONE implementation of form-patch semantics — the
   store wraps it and the live-sync server will apply peers' patches with
   it. These tables pin the invariants so a future edit that would make a
   synced session drift from a local tab fails here first. */

const straight: FormParams = PRESETS["classic-mug"]
const tapered: FormParams = PRESETS["tumbler"]

describe("applyFormPatch", () => {
  const cases: {
    name: string
    from: FormParams
    patch: UpdateFormInput
    expect: Partial<FormParams>
  }[] = [
    {
      name: "flares the top when taper turns on with no explicit top",
      from: straight,
      patch: { tapered: true },
      expect: {
        tapered: true,
        topDiameterMm: Math.min(300, Math.round(straight.bottomDiameterMm * 1.4)),
      },
    },
    {
      name: "respects an explicit top supplied with the taper switch",
      from: straight,
      patch: { tapered: true, topDiameterMm: 60 },
      expect: { tapered: true, topDiameterMm: 60 },
    },
    {
      name: "does not flare when top and bottom already differ",
      from: { ...straight, topDiameterMm: straight.bottomDiameterMm + 10, tapered: true },
      patch: { tapered: true },
      expect: { topDiameterMm: straight.bottomDiameterMm + 10 },
    },
    {
      name: "mirrors top onto bottom for straight forms",
      from: tapered,
      patch: { tapered: false },
      expect: { tapered: false, topDiameterMm: tapered.bottomDiameterMm },
    },
    {
      name: "mirrors even when the patch sets a contradictory top on a straight form",
      from: straight,
      patch: { topDiameterMm: 200 },
      expect: { topDiameterMm: straight.bottomDiameterMm },
    },
    {
      name: "legacy type 'tapered' means round + tapered (and flares)",
      from: straight,
      patch: { type: "tapered" } as never,
      expect: {
        type: "round",
        tapered: true,
        topDiameterMm: Math.min(300, Math.round(straight.bottomDiameterMm * 1.4)),
      },
    },
    {
      name: "legacy type 'cylinder' means round + straight",
      from: tapered,
      patch: { type: "cylinder" } as never,
      expect: { type: "round", tapered: false, topDiameterMm: tapered.bottomDiameterMm },
    },
    {
      name: "an explicit tapered flag wins over what the legacy type implies",
      from: tapered,
      patch: { type: "cylinder", tapered: true } as never,
      expect: { type: "round", tapered: true, topDiameterMm: tapered.topDiameterMm },
    },
    {
      name: "flare caps at 300 mm",
      from: { ...straight, topDiameterMm: 400, bottomDiameterMm: 400 },
      patch: { tapered: true },
      expect: { topDiameterMm: 300 },
    },
    {
      name: "an empty patch is the identity",
      from: tapered,
      patch: {},
      expect: tapered,
    },
  ]

  for (const c of cases) {
    it(c.name, () => {
      const result = applyFormPatch(c.from, c.patch)
      expect(result).toMatchObject(c.expect)
    })
  }

  it("does not mutate the current form", () => {
    const from = { ...straight }
    applyFormPatch(from, { tapered: true, heightMm: 120 })
    expect(from).toEqual(straight)
  })

  it("rejects out-of-contract values with ZodError, like the tools expect", () => {
    expect(() => applyFormPatch(straight, { heightMm: 5 })).toThrow(ZodError)
    expect(() => applyFormPatch(straight, { facets: 12 })).toThrow(ZodError)
    expect(() => applyFormPatch(straight, { type: "sphere" } as never)).toThrow(ZodError)
  })
})

describe("applyClayPatch", () => {
  it("merges a partial patch over current settings", () => {
    expect(applyClayPatch(DEFAULT_CLAY, { shrinkagePct: 14 })).toEqual({
      ...DEFAULT_CLAY,
      shrinkagePct: 14,
    })
  })

  it("an empty patch is the identity", () => {
    expect(applyClayPatch(DEFAULT_CLAY, {})).toEqual(DEFAULT_CLAY)
  })

  it("rejects out-of-contract values with ZodError", () => {
    expect(() => applyClayPatch(DEFAULT_CLAY, { shrinkagePct: 40 })).toThrow(ZodError)
    expect(() => applyClayPatch(DEFAULT_CLAY, { wallThicknessMm: 1 })).toThrow(ZodError)
  })
})
