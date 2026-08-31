import type { Piece } from "@/lib/geometry/unroll"
import {
  pieceContains,
  ANNOTATION_MM,
  type Pagination,
  type TemplateLayout,
  type Tile,
} from "./svg"

/**
 * Where to print the share-link QR on the TEMPLATE pages (the overview page
 * keeps its own copy). The cut-out pieces are what survive in a studio —
 * the overview is scaffolding — so the QR rides inside the largest piece,
 * linking the physical template back to the exact parametric model.
 *
 * Placement rules (see docs/live-sync-spec.md §6):
 *  - the QR is always 22 mm — never shrunk (scan reliability on handled
 *    paper beats fitting more pieces)
 *  - inside a piece it stays ≥ 8 mm clear of every cut/fold line and out
 *    of the piece's text block
 *  - when the largest piece can't host it, it moves just OUTSIDE that
 *    piece on the same printed page (drawn with a keep-tab outline so the
 *    potter cuts it out alongside)
 *  - it must land entirely on ONE printed tile — a QR split across two
 *    sheets scans only as well as the taping job
 */

export const TEMPLATE_QR_MM = 22
/** two 7pt caption lines under the QR ("scan to reopen / this design") */
export const QR_CAPTION_MM = 6
/** clearance kept between the QR block and any cut/fold line (inside placement) */
export const QR_EDGE_CLEAR_MM = 8
/** breathing room between an outside-placed QR block and any piece's content */
export const QR_OUTSIDE_GAP_MM = 4

/** full printed block: QR square plus its caption lines */
const BLOCK_W = TEMPLATE_QR_MM
const BLOCK_H = TEMPLATE_QR_MM + QR_CAPTION_MM

/** perimeter sampling step for shape-containment checks; with ≥8 mm of
    clearance, a 2 mm step cannot miss a crossing of any piece boundary
    (worst concave case — an inner sector arc — bulges < 0.03 mm per 2 mm
    chord at the radii the geometry produces) */
const SAMPLE_STEP_MM = 2

export interface QrPlacement {
  /** index into layout.placed of the piece the QR belongs to */
  pieceIndex: number
  /** layout-space top-left of the 22 mm QR square */
  x: number
  y: number
  /** true: inside the piece outline; false: beside it with a keep-tab outline */
  inside: boolean
  /** the one printed tile that fully contains the block */
  tile: Tile
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}

function pieceArea(piece: Piece): number {
  switch (piece.kind) {
    case "rectangle":
      return piece.widthMm * piece.heightMm
    case "trapezoid":
      return ((piece.topWidthMm + piece.bottomWidthMm) / 2) * piece.heightMm
    case "annularSector":
      return (piece.angleRad / 2) * (piece.outerRadiusMm ** 2 - piece.innerRadiusMm ** 2)
    case "disc":
      return Math.PI * (piece.diameterMm / 2) ** 2
    case "polygon":
      return ((piece.sides * piece.circumradiusMm ** 2) / 2) * Math.sin((2 * Math.PI) / piece.sides)
  }
}

function boxesIntersect(a: Box, b: Box, gap = 0): boolean {
  return (
    a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y
  )
}

/** every perimeter point of the box (sampled) lies inside the piece outline */
function boxInsidePiece(piece: Piece, box: Box): boolean {
  const xs: number[] = []
  const ys: number[] = []
  for (let x = box.x; x < box.x + box.w; x += SAMPLE_STEP_MM) xs.push(x)
  xs.push(box.x + box.w)
  for (let y = box.y; y < box.y + box.h; y += SAMPLE_STEP_MM) ys.push(y)
  ys.push(box.y + box.h)
  for (const x of xs) {
    if (!pieceContains(piece, x, box.y) || !pieceContains(piece, x, box.y + box.h)) return false
  }
  for (const y of ys) {
    if (!pieceContains(piece, box.x, y) || !pieceContains(piece, box.x + box.w, y)) return false
  }
  return true
}

/** the tile whose printable area fully contains the box, if any */
function containingTile(box: Box, pg: Pagination, tiles: Tile[]): Tile | undefined {
  return tiles.find(
    (t) =>
      box.x >= t.x0 &&
      box.y >= t.y0 &&
      box.x + box.w <= t.x0 + pg.printWidthMm &&
      box.y + box.h <= t.y0 + pg.printHeightMm
  )
}

export function placeTemplateQr(
  layout: TemplateLayout,
  pg: Pagination,
  tiles: Tile[]
): QrPlacement | null {
  if (layout.placed.length === 0 || tiles.length === 0) return null

  let pieceIndex = 0
  for (let i = 1; i < layout.placed.length; i++) {
    if (pieceArea(layout.placed[i].piece) > pieceArea(layout.placed[pieceIndex].piece)) {
      pieceIndex = i
    }
  }
  const host = layout.placed[pieceIndex]
  const { piece, graphic, dx, dy } = host

  // the piece's own text block (name above, label at, bevel stamp below
  // the label anchor) — the QR keeps out of it
  const textBlock: Box = {
    x: graphic.labelAt.x - Math.min(graphic.textWidthMm ?? graphic.widthMm, 80) / 2,
    y: graphic.labelAt.y - 13,
    w: Math.min(graphic.textWidthMm ?? graphic.widthMm, 80),
    h: 21,
  }

  const slides = [0, -20, 20, -40, 40]

  // -------------------------------------------------- inside the piece
  for (const yTop of [graphic.labelAt.y + 10, graphic.labelAt.y - 14 - BLOCK_H]) {
    for (const slide of slides) {
      const local: Box = { x: graphic.labelAt.x + slide - BLOCK_W / 2, y: yTop, w: BLOCK_W, h: BLOCK_H }
      const cleared: Box = {
        x: local.x - QR_EDGE_CLEAR_MM,
        y: local.y - QR_EDGE_CLEAR_MM,
        w: local.w + 2 * QR_EDGE_CLEAR_MM,
        h: local.h + 2 * QR_EDGE_CLEAR_MM,
      }
      if (boxesIntersect(local, textBlock)) continue
      if (!boxInsidePiece(piece, cleared)) continue
      const inLayout: Box = { x: local.x + dx, y: local.y + dy, w: BLOCK_W, h: BLOCK_H }
      const tile = containingTile(inLayout, pg, tiles)
      if (tile) return { pieceIndex, x: inLayout.x, y: inLayout.y, inside: true, tile }
    }
  }

  // ------------------------------- just outside the piece, same page
  // everything any piece puts on paper, padded by the breathing gap
  const content: Box[] = layout.placed.map((p) => ({
    x: p.dx,
    y: p.dy,
    w: p.graphic.widthMm,
    h: p.graphic.heightMm + ANNOTATION_MM,
  }))
  const outside: Box[] = []
  for (const slide of [0, ...slides.slice(1)]) {
    // right and left of the piece, at label height then slid vertically
    const yMid = dy + graphic.labelAt.y - BLOCK_H / 2 + slide
    outside.push({ x: dx + graphic.widthMm + QR_OUTSIDE_GAP_MM, y: yMid, w: BLOCK_W, h: BLOCK_H })
    outside.push({ x: dx - QR_OUTSIDE_GAP_MM - BLOCK_W, y: yMid, w: BLOCK_W, h: BLOCK_H })
    // below the piece's annotation row, slid horizontally
    outside.push({
      x: dx + graphic.labelAt.x - BLOCK_W / 2 + slide,
      y: dy + graphic.heightMm + ANNOTATION_MM + QR_OUTSIDE_GAP_MM,
      w: BLOCK_W,
      h: BLOCK_H,
    })
  }
  for (const box of outside) {
    if (box.x < 0 || box.y < 0) continue
    if (content.some((c) => boxesIntersect(box, c, QR_OUTSIDE_GAP_MM))) continue
    const tile = containingTile(box, pg, tiles)
    if (tile) return { pieceIndex, x: box.x, y: box.y, inside: false, tile }
  }

  // nowhere safe on the template pages — the overview QR alone remains
  return null
}
