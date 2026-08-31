import { describe, expect, it } from "vitest"
import { buildPieces } from "@/lib/geometry/unroll"
import { DEFAULT_CLAY, PRESETS, type FormParams } from "@/lib/model/schemas"
import {
  placeTemplateQr,
  QR_EDGE_CLEAR_MM,
  QR_CAPTION_MM,
  TEMPLATE_QR_MM,
  type QrPlacement,
} from "./qrPlacement"
import {
  contentTiles,
  layoutPieces,
  paginate,
  pieceContains,
  pieceGraphic,
  ANNOTATION_MM,
  type Pagination,
  type PaperSize,
  type TemplateLayout,
} from "./svg"

const BLOCK_W = TEMPLATE_QR_MM
const BLOCK_H = TEMPLATE_QR_MM + QR_CAPTION_MM

function place(form: FormParams, paper: PaperSize = "A4") {
  const layout = layoutPieces(buildPieces(form, DEFAULT_CLAY), paper)
  const pg = paginate(layout.widthMm, layout.heightMm, paper)
  const tiles = contentTiles(layout, pg)
  return { layout, pg, placement: placeTemplateQr(layout, pg, tiles) }
}

/** the invariants every returned placement must satisfy, whatever the form */
function expectValid(placement: QrPlacement, layout: TemplateLayout, pg: Pagination): void {
  // the whole block prints on its one page
  expect(placement.x).toBeGreaterThanOrEqual(placement.tile.x0)
  expect(placement.y).toBeGreaterThanOrEqual(placement.tile.y0)
  expect(placement.x + BLOCK_W).toBeLessThanOrEqual(placement.tile.x0 + pg.printWidthMm)
  expect(placement.y + BLOCK_H).toBeLessThanOrEqual(placement.tile.y0 + pg.printHeightMm)

  if (placement.inside) {
    // the block plus its clearance stays inside the host piece's outline —
    // sample the inflated border densely, same contract the module promises
    const { piece, dx, dy } = layout.placed[placement.pieceIndex]
    const x0 = placement.x - dx - QR_EDGE_CLEAR_MM
    const y0 = placement.y - dy - QR_EDGE_CLEAR_MM
    const x1 = placement.x - dx + BLOCK_W + QR_EDGE_CLEAR_MM
    const y1 = placement.y - dy + BLOCK_H + QR_EDGE_CLEAR_MM
    for (let x = x0; x <= x1; x += 1) {
      expect(pieceContains(piece, x, y0)).toBe(true)
      expect(pieceContains(piece, x, y1)).toBe(true)
    }
    for (let y = y0; y <= y1; y += 1) {
      expect(pieceContains(piece, x0, y)).toBe(true)
      expect(pieceContains(piece, x1, y)).toBe(true)
    }
  } else {
    // beside a piece: overlaps no piece's content (outline + annotation row)
    for (const { graphic, dx, dy } of layout.placed) {
      const overlaps =
        placement.x < dx + graphic.widthMm &&
        placement.x + BLOCK_W > dx &&
        placement.y < dy + graphic.heightMm + ANNOTATION_MM &&
        placement.y + BLOCK_H > dy
      expect(overlaps).toBe(false)
    }
  }
}

describe("placeTemplateQr", () => {
  it("puts the QR inside the classic mug's wall rectangle", () => {
    const { layout, pg, placement } = place(PRESETS["classic-mug"])
    expect(placement).not.toBeNull()
    expect(placement!.inside).toBe(true)
    expect(layout.placed[placement!.pieceIndex].piece.kind).toBe("rectangle")
    expectValid(placement!, layout, pg)
  })

  it("handles the tumbler's annular-sector wall", () => {
    const { layout, pg, placement } = place(PRESETS["tumbler"])
    expect(placement).not.toBeNull()
    expect(layout.placed[placement!.pieceIndex].piece.kind).toBe("annularSector")
    expectValid(placement!, layout, pg)
  })

  it("handles the bud vase (steep taper) and hex planter (faceted)", () => {
    for (const preset of ["bud-vase", "hex-planter"] as const) {
      const { layout, pg, placement } = place(PRESETS[preset])
      expect(placement).not.toBeNull()
      expectValid(placement!, layout, pg)
    }
  })

  it("moves outside the piece for a form too small to host 22 mm + clearance", () => {
    const tiny: FormParams = {
      type: "round",
      tapered: false,
      name: "Thimble",
      heightMm: 25,
      topDiameterMm: 40,
      bottomDiameterMm: 40,
      facets: 4,
    }
    const { layout, pg, placement } = place(tiny)
    expect(placement).not.toBeNull()
    expect(placement!.inside).toBe(false)
    expectValid(placement!, layout, pg)
  })

  it("never shrinks: an outside placement is still the full 22 mm block", () => {
    // the constant is the contract — pdf.ts draws TEMPLATE_QR_MM everywhere
    expect(TEMPLATE_QR_MM).toBe(22)
  })

  it("stays valid across paper sizes and a multi-page wall", () => {
    const wide: FormParams = {
      type: "round",
      tapered: false,
      name: "Big planter",
      heightMm: 300,
      topDiameterMm: 300,
      bottomDiameterMm: 300,
      facets: 4,
    }
    for (const paper of ["A4", "A3", "Letter"] as const) {
      const { layout, pg, placement } = place(wide, paper)
      expect(placement).not.toBeNull()
      expectValid(placement!, layout, pg)
    }
  })

  it("picks the largest piece as host", () => {
    const { layout, placement } = place(PRESETS["classic-mug"])
    const areas = layout.placed.map(
      ({ graphic }) => graphic.widthMm * graphic.heightMm
    )
    // the wall's bbox dwarfs the base disc's for every preset
    expect(areas[placement!.pieceIndex]).toBe(Math.max(...areas))
  })
})

describe("pieceContains", () => {
  it("agrees with the disc outline", () => {
    const disc = { kind: "disc", diameterMm: 100 } as const
    const piece = { ...disc, id: "base", label: "Base" } as never
    expect(pieceContains(piece, 50, 50)).toBe(true)
    expect(pieceContains(piece, 50, 1)).toBe(true)
    expect(pieceContains(piece, 2, 2)).toBe(false)
  })

  it("respects a trapezoid's slanted edges", () => {
    const piece = {
      kind: "trapezoid",
      topWidthMm: 40,
      bottomWidthMm: 100,
      heightMm: 80,
      id: "p",
      label: "P",
    } as never
    expect(pieceContains(piece, 50, 40)).toBe(true)
    // top corners of the bounding box are outside the slant
    expect(pieceContains(piece, 2, 2)).toBe(false)
    expect(pieceContains(piece, 98, 2)).toBe(false)
  })

  it("excludes the notch inside an annular sector's inner arc", () => {
    const tumbler = buildPieces(PRESETS["tumbler"], DEFAULT_CLAY)
    const wall = tumbler.find((p) => p.kind === "annularSector")!
    // the label anchor (mid-radius on the bisector) is inside…
    const g = pieceGraphic(wall)
    expect(pieceContains(wall, g.labelAt.x, g.labelAt.y)).toBe(true)
    // …the bounding-box bottom-center sits in the inner-arc notch, outside
    expect(pieceContains(wall, g.widthMm / 2, g.heightMm)).toBe(false)
  })
})
