import { describe, expect, it } from "vitest"
import { countPages, layoutPieces, paginate, pieceGraphic, textFits, tickMarks } from "./svg"
import type { Piece } from "@/lib/geometry/unroll"

const rect: Piece = { kind: "rectangle", id: "wall", label: "Wall", widthMm: 285.6, heightMm: 113.6, notes: [] }
const disc: Piece = { kind: "disc", id: "base", label: "Base", diameterMm: 85.2, notes: [] }
const sector: Piece = {
  kind: "annularSector",
  id: "wall",
  label: "Wall",
  innerRadiusMm: 356.2,
  outerRadiusMm: 504.6,
  angleRad: (34.5 * Math.PI) / 180,
  outerArcMm: 303.4,
  innerArcMm: 214.2,
  slantMm: 148.4,
  notes: [],
}

describe("pieceGraphic", () => {
  it("rectangle bbox matches its dimensions and marks both seam edges", () => {
    const g = pieceGraphic(rect)
    expect(g.widthMm).toBeCloseTo(285.6)
    expect(g.heightMm).toBeCloseTo(113.6)
    expect(g.seams).toHaveLength(2)
  })

  it("disc bbox is diameter x diameter with no seams", () => {
    const g = pieceGraphic(disc)
    expect(g.widthMm).toBeCloseTo(85.2)
    expect(g.heightMm).toBeCloseTo(85.2)
    expect(g.seams).toHaveLength(0)
  })

  it("sector bbox width equals the outer chord for angles < 180deg", () => {
    const g = pieceGraphic(sector)
    const chord = 2 * sector.outerRadiusMm * Math.sin(sector.angleRad / 2)
    expect(g.widthMm).toBeCloseTo(chord, 1)
    expect(g.seams).toHaveLength(2)
    // radial seam length = slant
    const s = g.seams[0]
    expect(Math.hypot(s.x2 - s.x1, s.y2 - s.y1)).toBeCloseTo(sector.slantMm, 1)
  })

  it("sector outline stays inside its bounding box", () => {
    const g = pieceGraphic(sector)
    for (const s of g.seams) {
      for (const [x, y] of [
        [s.x1, s.y1],
        [s.x2, s.y2],
      ]) {
        expect(x).toBeGreaterThanOrEqual(-0.01)
        expect(y).toBeGreaterThanOrEqual(-0.01)
        expect(x).toBeLessThanOrEqual(g.widthMm + 0.01)
        expect(y).toBeLessThanOrEqual(g.heightMm + 0.01)
      }
    }
  })
})

describe("tickMarks", () => {
  it("puts perpendicular ticks along the edge", () => {
    const ticks = tickMarks({ x1: 0, y1: 0, x2: 0, y2: 100 }, 3, 4)
    expect(ticks).toHaveLength(3)
    expect(ticks[1].y1).toBeCloseTo(50)
    expect(Math.min(ticks[1].x1, ticks[1].x2)).toBeCloseTo(-2)
    expect(Math.max(ticks[1].x1, ticks[1].x2)).toBeCloseTo(2)
  })
})

describe("layoutPieces", () => {
  it("wraps to a new shelf when a piece would exceed one page width", () => {
    // the mug wall (285.6mm) overflows a page column, so the disc wraps below
    const layout = layoutPieces([rect, disc])
    expect(layout.placed[1].dx).toBe(0)
    expect(layout.placed[1].dy).toBeGreaterThan(rect.heightMm)
    expect(layout.widthMm).toBeCloseTo(285.6)
  })

  it("packs small pieces side by side on one shelf", () => {
    const side: Piece = { kind: "rectangle", id: "side", label: "Side", widthMm: 60, heightMm: 110, notes: [] }
    const layout = layoutPieces([side, disc])
    expect(layout.placed[1].dy).toBe(0) // same shelf as the side panel
    expect(layout.placed[1].dx).toBeGreaterThan(60) // to its right, after the gap
    expect(layout.heightMm).toBeLessThan(110 + 85.2) // shorter than stacking
  })

  it("never lets shelf-mates overlap horizontally", () => {
    const side: Piece = { kind: "rectangle", id: "side", label: "Side", widthMm: 60, heightMm: 110, notes: [] }
    const layout = layoutPieces([side, disc, side, disc])
    for (const a of layout.placed) {
      for (const b of layout.placed) {
        if (a === b || a.dy !== b.dy) continue
        const apart = a.dx + a.graphic.widthMm <= b.dx || b.dx + b.graphic.widthMm <= a.dx
        expect(apart).toBe(true)
      }
    }
  })
})

describe("paginate", () => {
  it("fits a small piece on one page", () => {
    const p = paginate(100, 100, "A4")
    expect(p.cols).toBe(1)
    expect(p.rows).toBe(1)
  })

  it("tiles a mug wall wider than one A4 page onto two columns", () => {
    const p = paginate(285.6, 250, "A4")
    expect(p.cols).toBe(2)
    expect(p.rows).toBe(1)
  })

  it("pages overlap by the glue margin", () => {
    const p = paginate(500, 500, "A4")
    expect(p.printWidthMm - p.stepWidthMm).toBeCloseTo(10)
  })
})

describe("polygon graphic", () => {
  const hexBase: Piece = {
    kind: "polygon",
    id: "base",
    label: "Base",
    sides: 6,
    circumradiusMm: 50,
    notes: [],
  }

  it("hexagon bbox: across-corners wide, across-flats tall (flat-bottom orientation)", () => {
    const g = pieceGraphic(hexBase)
    expect(g.widthMm).toBeCloseTo(2 * 50, 3)
    expect(g.heightMm).toBeCloseTo(2 * 50 * Math.cos(Math.PI / 6), 3)
    expect(g.seams).toHaveLength(0)
  })

  it("square renders axis-aligned (flat bottom), sized across flats", () => {
    const g = pieceGraphic({ ...hexBase, sides: 4 } as Piece)
    const acrossFlats = 2 * 50 * Math.cos(Math.PI / 4)
    expect(g.widthMm).toBeCloseTo(acrossFlats, 3)
    expect(g.heightMm).toBeCloseTo(acrossFlats, 3)
  })
})

describe("textFits", () => {
  it("empty text always fits", () => {
    expect(textFits("", 6, 0)).toBe(true)
  })

  it("a short label fits a normal-sized piece", () => {
    expect(textFits("Wall", 6, 285.6)).toBe(true)
  })

  it("a long project name does not fit a tiny piece", () => {
    expect(textFits("A very long espresso cup project name", 3.2, 20)).toBe(false)
  })
})

describe("countPages", () => {
  it("matches the export: content tiles plus one overview page", () => {
    const layout = layoutPieces([rect, disc])
    const pages = countPages(layout, "A4")
    // mug wall is 285.6mm wide -> 2 columns, everything on one row
    expect(pages.templatePages).toBe(2)
    expect(pages.totalPages).toBe(3)
  })

  it("skips grid tiles with no content", () => {
    const tall: Piece = { kind: "rectangle", id: "wall", label: "Wall", widthMm: 80, heightMm: 600, notes: [] }
    const layout = layoutPieces([tall])
    const pages = countPages(layout, "A4")
    // 1 column x 3 rows, all with content
    expect(pages.pagination.cols).toBe(1)
    expect(pages.templatePages).toBeLessThanOrEqual(pages.pagination.cols * pages.pagination.rows)
    expect(pages.totalPages).toBe(pages.templatePages + 1)
  })
})
