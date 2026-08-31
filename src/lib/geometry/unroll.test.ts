import { describe, expect, it } from "vitest"
import { buildPieces, capacityMl, describePiece, facetBevelDeg, formWarnings, heightForCapacityMl, shrinkageScale, unrollCylinder, unrollFrustum } from "./unroll"
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
    type: "round",
    tapered: false,
    name: "test",
    heightMm: 100,
    topDiameterMm: 85,
    bottomDiameterMm: 85,
    facets: 4,
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
    const tumbler: FormParams = { ...mug, tapered: true, topDiameterMm: 90, bottomDiameterMm: 65 }
    const [wall] = buildPieces(tumbler, clay)
    expect(wall.kind).toBe("annularSector")
    if (wall.kind !== "annularSector") throw new Error("expected annular sector wall")
    expect(wall.stamp).toBe("bevel seam 45°")
  })

  it("treats sub-tolerance taper as straight instead of a degenerate sector", () => {
    const nearly: FormParams = { ...mug, tapered: true, topDiameterMm: 85.01, bottomDiameterMm: 85 }
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

  describe("faceted prisms", () => {
    const square: FormParams = { ...mug, type: "faceted", facets: 4, bottomDiameterMm: 100 }

    it("side panel width is the outer polygon side length (no mid-surface correction)", () => {
      const [side] = buildPieces(square, clay)
      if (side.kind !== "rectangle") throw new Error("expected rectangle side")
      // circumradius 50, N=4: side = 2*50*sin(45deg)
      expect(side.widthMm).toBeCloseTo(2 * 50 * Math.sin(Math.PI / 4), 5)
      expect(side.heightMm).toBe(square.heightMm)
    })

    it("notes say how many copies to cut and the miter bevel angle", () => {
      const [side] = buildPieces(square, clay)
      expect(side.notes.join(" ")).toMatch(/Cut 4 copies/)
      expect(side.notes.join(" ")).toMatch(/45°/)
    })

    it("the printable stamp carries the copy count and bevel", () => {
      const [side] = buildPieces(square, clay)
      if (side.kind !== "rectangle") throw new Error("expected rectangle side")
      expect(side.stamp).toBe("cut 4 · bevel 45°")
    })

    it("base is a polygon inset by the wall thickness across the flats", () => {
      const base = buildPieces(square, clay).find((p) => p.id === "base")
      if (base?.kind !== "polygon") throw new Error("expected polygon base")
      expect(base.sides).toBe(4)
      // outer apothem = 50*cos(45deg); inner = apothem - t; back to circumradius
      const expected = (50 * Math.cos(Math.PI / 4) - clay.wallThicknessMm) / Math.cos(Math.PI / 4)
      expect(base.circumradiusMm).toBeCloseTo(expected, 5)
    })

    it("hexagon bevel is 30 degrees", () => {
      const hex: FormParams = { ...square, facets: 6 }
      const [side] = buildPieces(hex, clay)
      expect(side.notes.join(" ")).toMatch(/30°/)
      expect(side.notes.join(" ")).toMatch(/Cut 6 copies/)
    })

    it("octagon bevel is 22.5 degrees", () => {
      const oct: FormParams = { ...square, facets: 8 }
      const [side] = buildPieces(oct, clay)
      expect(side.notes.join(" ")).toMatch(/22\.5°/)
      expect(side.notes.join(" ")).toMatch(/Cut 8 copies/)
    })

    it("warns when walls leave no room for the base, measured across flats", () => {
      const warnings = formWarnings(
        { ...square, facets: 3, bottomDiameterMm: 40 },
        { ...clay, wallThicknessMm: 12 }
      )
      // triangle apothem = 20*cos(60deg) = 10 < 12 -> impossible
      expect(warnings.join(" ")).toMatch(/no room/i)
    })
  })
})

describe("formWarnings", () => {
  const mug: FormParams = {
    type: "round",
    tapered: false,
    name: "test",
    heightMm: 100,
    topDiameterMm: 85,
    bottomDiameterMm: 85,
    facets: 4,
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
      { ...mug, tapered: true, topDiameterMm: 86, bottomDiameterMm: 85, heightMm: 200 },
      clay
    )
    expect(warnings.join(" ")).toMatch(/taper/i)
  })
})

describe("describePiece", () => {
  const disc = { kind: "disc" as const, id: "base", label: "Base", diameterMm: 100, notes: [] }

  it("omits the fired parenthetical when there is no shrinkage (scale=1, the default)", () => {
    expect(describePiece(disc)).toBe("Base: disc, diameter 10 cm")
  })

  it("shows the fired size alongside the printed size when scale != 1", () => {
    const scale = shrinkageScale(12) // wet 100mm -> fired 88mm
    const text = describePiece(disc, scale)
    expect(text).toContain("10 cm")
    expect(text).toContain("8.8 cm fired")
  })

  it("renders in inches when asked", () => {
    expect(describePiece(disc, 1, "in")).toBe("Base: disc, diameter 3.94 in")
    const text = describePiece(disc, shrinkageScale(12), "in")
    expect(text).toContain("3.94 in")
    expect(text).toContain("3.46 in fired")
  })
})

describe("capacityMl", () => {
  const mug: FormParams = {
    type: "round",
    tapered: false,
    name: "Mug",
    heightMm: 100,
    topDiameterMm: 85,
    bottomDiameterMm: 85,
    facets: 4,
  }

  it("computes a cylinder interior with fired wall and floor", () => {
    // shrinkage 12%: fired wall = 5 * 0.88 = 4.4mm
    // rIn = 42.5 - 4.4 = 38.1, hIn = 100 - 4.4 = 95.6
    const expected = Math.round((Math.PI * 38.1 ** 2 * 95.6) / 1000)
    expect(capacityMl(mug, { shrinkagePct: 12, wallThicknessMm: 5 })).toBe(expected)
  })

  it("a flared tapered form holds more than the straight cylinder", () => {
    const flared: FormParams = { ...mug, tapered: true, topDiameterMm: 120 }
    const c = { shrinkagePct: 12, wallThicknessMm: 5 }
    expect(capacityMl(flared, c)).toBeGreaterThan(capacityMl(mug, c))
  })

  it("a hexagon holds less than its circumscribed cylinder", () => {
    const hex: FormParams = { ...mug, type: "faceted", facets: 6 }
    const c = { shrinkagePct: 12, wallThicknessMm: 5 }
    expect(capacityMl(hex, c)).toBeGreaterThan(0)
    expect(capacityMl(hex, c)).toBeLessThan(capacityMl(mug, c))
  })

  it("degenerates to zero instead of going negative", () => {
    const tiny: FormParams = { ...mug, bottomDiameterMm: 20, topDiameterMm: 20 }
    expect(capacityMl(tiny, { shrinkagePct: 0, wallThicknessMm: 15 })).toBe(0)
  })
})

describe("tapered faceted prisms", () => {
  const base: FormParams = {
    type: "faceted",
    tapered: true,
    name: "test",
    heightMm: 120,
    topDiameterMm: 140,
    bottomDiameterMm: 100,
    facets: 6,
  }
  const clay0: ClaySettings = { shrinkagePct: 0, wallThicknessMm: 5 }

  it("side panels become trapezoids with polygon side lengths at each end", () => {
    const [side] = buildPieces(base, clay0)
    if (side.kind !== "trapezoid") throw new Error("expected trapezoid side")
    expect(side.topWidthMm).toBeCloseTo(2 * 70 * Math.sin(Math.PI / 6), 5)
    expect(side.bottomWidthMm).toBeCloseTo(2 * 50 * Math.sin(Math.PI / 6), 5)
  })

  it("panel height is the slant, longer than the vessel height", () => {
    const [side] = buildPieces(base, clay0)
    if (side.kind !== "trapezoid") throw new Error("expected trapezoid side")
    const dApothem = (70 - 50) * Math.cos(Math.PI / 6)
    expect(side.heightMm).toBeCloseTo(Math.hypot(120, dApothem), 5)
    expect(side.heightMm).toBeGreaterThan(120)
  })

  it("taper shallows the miter bevel below the straight-prism angle", () => {
    const straight = facetBevelDeg(6, 50, 50, 120)
    expect(straight).toBeCloseTo(30, 8)
    const tapered = facetBevelDeg(6, 70 * Math.cos(Math.PI / 6), 50 * Math.cos(Math.PI / 6), 120)
    expect(tapered).toBeLessThan(30)
    expect(tapered).toBeGreaterThan(25)
  })

  it("a sub-tolerance taper still cuts rectangles", () => {
    const nearly: FormParams = { ...base, topDiameterMm: 100.01, bottomDiameterMm: 100 }
    const [side] = buildPieces(nearly, clay0)
    expect(side.kind).toBe("rectangle")
  })

  it("a flared tapered hexagon holds more than the straight one", () => {
    const straight: FormParams = { ...base, tapered: false, topDiameterMm: 100 }
    const c = { shrinkagePct: 12, wallThicknessMm: 5 }
    expect(capacityMl(base, c)).toBeGreaterThan(capacityMl(straight, c))
  })
})

describe("heightForCapacityMl", () => {
  const mug: FormParams = {
    type: "round",
    tapered: false,
    name: "Mug",
    heightMm: 100,
    topDiameterMm: 85,
    bottomDiameterMm: 85,
    facets: 4,
  }
  const c: ClaySettings = { shrinkagePct: 12, wallThicknessMm: 5 }

  it("solves the height that yields the target capacity exactly", () => {
    const h = heightForCapacityMl(mug, c, 350)
    expect(h).not.toBeNull()
    expect(capacityMl({ ...mug, heightMm: h! }, c)).toBe(350)
  })

  it("works for tapered faceted forms too", () => {
    const hexTapered: FormParams = {
      ...mug,
      type: "faceted",
      tapered: true,
      facets: 6,
      bottomDiameterMm: 100,
      topDiameterMm: 150,
    }
    const h = heightForCapacityMl(hexTapered, c, 1000)
    expect(h).not.toBeNull()
    expect(capacityMl({ ...hexTapered, heightMm: h! }, c)).toBe(1000)
  })

  it("returns null when the walls close the interior", () => {
    const tiny: FormParams = { ...mug, bottomDiameterMm: 20, topDiameterMm: 20 }
    expect(heightForCapacityMl(tiny, { shrinkagePct: 0, wallThicknessMm: 15 }, 100)).toBeNull()
  })
})
