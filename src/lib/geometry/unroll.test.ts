import { describe, expect, it } from "vitest"
import { buildPieces, describePiece, formWarnings, shrinkageScale, unrollCylinder, unrollFrustum } from "./unroll"
import type { ClaySettings, FormParams } from "@/lib/model/schemas"

const clay: ClaySettings = { shrinkagePct: 0, wallThicknessMm: 5 }

describe("shrinkageScale", () => {
  it("is identity at 0%", () => {
    expect(shrinkageScale(0)).toBe(1)
  })
  it("scales up so fired size matches design", () => {
    // 12% shrinkage: wet 100mm -> fired 88mm, so design 88mm needs wet 100mm
    const s = shrinkageScale(12)
    expect(88 * s).toBeCloseTo(100, 10)
  })
})

describe("unrollCylinder", () => {
  it("width equals mid-surface circumference", () => {
    const r = 40
    const piece = unrollCylinder(r, 100)
    expect(piece.widthMm).toBeCloseTo(2 * Math.PI * r)
    expect(piece.heightMm).toBe(100)
  })
})

describe("unrollFrustum", () => {
  it("arc lengths match the two circumferences", () => {
    const rTop = 45
    const rBot = 32.5
    const piece = unrollFrustum(rTop, rBot, 130)
    expect(piece.outerArcMm).toBeCloseTo(2 * Math.PI * rTop)
    expect(piece.innerArcMm).toBeCloseTo(2 * Math.PI * rBot)
  })

  it("radial width of the sector equals the slant height", () => {
    const piece = unrollFrustum(45, 32.5, 130)
    expect(piece.outerRadiusMm - piece.innerRadiusMm).toBeCloseTo(piece.slantMm)
    expect(piece.slantMm).toBeCloseTo(Math.hypot(45 - 32.5, 130))
  })

  it("handles flared forms (bottom wider than top)", () => {
    const piece = unrollFrustum(22.5, 45, 180)
    expect(piece.outerArcMm).toBeCloseTo(2 * Math.PI * 45)
    expect(piece.innerArcMm).toBeCloseTo(2 * Math.PI * 22.5)
  })
})

describe("buildPieces", () => {
  const mug: FormParams = {
    type: "cylinder",
    name: "test",
    heightMm: 100,
    topDiameterMm: 85,
    bottomDiameterMm: 85,
  }

  it("develops the mid-surface, not the outer skin", () => {
    const [wall] = buildPieces(mug, clay)
    if (wall.kind !== "rectangle") throw new Error("expected rectangle wall")
    const midR = 85 / 2 - clay.wallThicknessMm / 2
    expect(wall.widthMm).toBeCloseTo(2 * Math.PI * midR)
  })

  it("sizes the base to the inner wall", () => {
    const base = buildPieces(mug, clay).find((p) => p.id === "base")
    if (base?.kind !== "disc") throw new Error("expected disc base")
    expect(base.diameterMm).toBeCloseTo(85 - 2 * clay.wallThicknessMm)
  })

  it("applies shrinkage to every dimension", () => {
    const shrinky = { ...clay, shrinkagePct: 12 }
    const [wall] = buildPieces(mug, shrinky)
    if (wall.kind !== "rectangle") throw new Error("expected rectangle wall")
    expect(wall.heightMm).toBeCloseTo(100 / 0.88)
  })

  it("produces a sector wall for tapered forms", () => {
    const tumbler: FormParams = { ...mug, type: "tapered", topDiameterMm: 90, bottomDiameterMm: 65 }
    const [wall] = buildPieces(tumbler, clay)
    expect(wall.kind).toBe("annularSector")
  })

  it("treats sub-tolerance taper as straight instead of a degenerate sector", () => {
    const nearly: FormParams = { ...mug, type: "tapered", topDiameterMm: 85.01, bottomDiameterMm: 85 }
    const [wall] = buildPieces(nearly, clay)
    expect(wall.kind).toBe("rectangle")
  })

  it("never emits a negative base disc when walls are thicker than the radius", () => {
    const thick = { ...clay, wallThicknessMm: 15 }
    const tiny: FormParams = { ...mug, bottomDiameterMm: 20, topDiameterMm: 20 }
    const base = buildPieces(tiny, thick).find((p) => p.id === "base")
    if (base?.kind !== "disc") throw new Error("expected disc base")
    expect(base.diameterMm).toBeGreaterThanOrEqual(0)
  })
})

describe("formWarnings", () => {
  const mug: FormParams = {
    type: "cylinder",
    name: "test",
    heightMm: 100,
    topDiameterMm: 85,
    bottomDiameterMm: 85,
  }

  it("is quiet for a sane design", () => {
    expect(formWarnings(mug, clay)).toEqual([])
  })

  it("flags walls that leave no room for a base", () => {
    const warnings = formWarnings(
      { ...mug, bottomDiameterMm: 20, topDiameterMm: 20 },
      { ...clay, wallThicknessMm: 15 }
    )
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings.join(" ")).toMatch(/no room/i)
  })

  it("flags a nearly-straight taper as unwieldy", () => {
    const warnings = formWarnings(
      { ...mug, type: "tapered", topDiameterMm: 86, bottomDiameterMm: 85, heightMm: 200 },
      clay
    )
    expect(warnings.join(" ")).toMatch(/taper/i)
  })
})

describe("describePiece", () => {
  const disc = { kind: "disc" as const, id: "base", label: "Base", diameterMm: 100, notes: [] }

  it("omits the fired parenthetical when there is no shrinkage (scale=1, the default)", () => {
    expect(describePiece(disc)).toBe("Base: disc, diameter 100.0 mm")
  })

  it("shows the fired size alongside the printed size when scale != 1", () => {
    const scale = shrinkageScale(12) // wet 100mm -> fired 88mm
    const text = describePiece(disc, scale)
    expect(text).toContain("100.0 mm")
    expect(text).toContain("88.0 mm fired")
  })
})
