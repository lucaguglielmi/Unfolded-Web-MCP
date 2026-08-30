import type { Piece } from "@/lib/geometry/unroll"

/**
 * Pure SVG-path generation for template pieces. All coordinates are
 * millimeters; each piece's outline lives in local coordinates with the
 * origin at its bounding-box top-left. The on-screen template view and the
 * PDF exporter both consume these.
 */

export interface Vec {
  x: number
  y: number
}

export interface Segment {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface PieceGraphic {
  /** closed outline path (mm, local coords) */
  d: string
  /** straight cut edges that get joined when wrapping — marked as seams */
  seams: Segment[]
  widthMm: number
  heightMm: number
  labelAt: Vec
}

const fmt = (n: number) => Number(n.toFixed(3)).toString()

function rectangleGraphic(widthMm: number, heightMm: number): PieceGraphic {
  return {
    d: `M 0 0 H ${fmt(widthMm)} V ${fmt(heightMm)} H 0 Z`,
    seams: [
      { x1: 0, y1: 0, x2: 0, y2: heightMm },
      { x1: widthMm, y1: 0, x2: widthMm, y2: heightMm },
    ],
    widthMm,
    heightMm,
    labelAt: { x: widthMm / 2, y: heightMm / 2 },
  }
}

function sectorGraphic(innerRadiusMm: number, outerRadiusMm: number, angleRad: number): PieceGraphic {
  // Fan opens upward: angles symmetric around -90deg (y-down SVG coords).
  const a0 = -Math.PI / 2 - angleRad / 2
  const a1 = a0 + angleRad
  const at = (a: number, r: number): Vec => ({ x: r * Math.cos(a), y: r * Math.sin(a) })

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const SAMPLES = 128
  for (let i = 0; i <= SAMPLES; i++) {
    const a = a0 + (angleRad * i) / SAMPLES
    for (const r of [innerRadiusMm, outerRadiusMm]) {
      const p = at(a, r)
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
  }

  const shift = (p: Vec): Vec => ({ x: p.x - minX, y: p.y - minY })
  const p = (a: number, r: number) => {
    const v = shift(at(a, r))
    return `${fmt(v.x)} ${fmt(v.y)}`
  }
  const largeArc = angleRad > Math.PI ? 1 : 0
  const rO = fmt(outerRadiusMm)
  const rI = fmt(innerRadiusMm)
  const d =
    `M ${p(a0, outerRadiusMm)} ` +
    `A ${rO} ${rO} 0 ${largeArc} 1 ${p(a1, outerRadiusMm)} ` +
    `L ${p(a1, innerRadiusMm)} ` +
    `A ${rI} ${rI} 0 ${largeArc} 0 ${p(a0, innerRadiusMm)} Z`

  const seamAt = (a: number): Segment => {
    const s1 = shift(at(a, innerRadiusMm))
    const s2 = shift(at(a, outerRadiusMm))
    return { x1: s1.x, y1: s1.y, x2: s2.x, y2: s2.y }
  }
  const mid = shift(at(-Math.PI / 2, (innerRadiusMm + outerRadiusMm) / 2))

  return {
    d,
    seams: [seamAt(a0), seamAt(a1)],
    widthMm: maxX - minX,
    heightMm: maxY - minY,
    labelAt: mid,
  }
}

function polygonGraphic(sides: number, circumradiusMm: number): PieceGraphic {
  // Vertices oriented so the bottom edge is horizontal (y-down coords):
  // two adjacent vertices sit symmetric about the downward vertical.
  const pts: Vec[] = []
  for (let k = 0; k < sides; k++) {
    const a = Math.PI / 2 - Math.PI / sides + (2 * Math.PI * k) / sides
    pts.push({ x: circumradiusMm * Math.cos(a), y: circumradiusMm * Math.sin(a) })
  }
  const minX = Math.min(...pts.map((p) => p.x))
  const minY = Math.min(...pts.map((p) => p.y))
  const maxX = Math.max(...pts.map((p) => p.x))
  const maxY = Math.max(...pts.map((p) => p.y))
  const d =
    pts.map((p, i) => `${i === 0 ? "M" : "L"} ${fmt(p.x - minX)} ${fmt(p.y - minY)}`).join(" ") + " Z"
  return {
    d,
    seams: [],
    widthMm: maxX - minX,
    heightMm: maxY - minY,
    labelAt: { x: -minX, y: -minY },
  }
}

function discGraphic(diameterMm: number): PieceGraphic {
  const r = diameterMm / 2
  const rs = fmt(r)
  return {
    d: `M ${rs} 0 A ${rs} ${rs} 0 1 1 ${rs} ${fmt(diameterMm)} A ${rs} ${rs} 0 1 1 ${rs} 0 Z`,
    seams: [],
    widthMm: diameterMm,
    heightMm: diameterMm,
    labelAt: { x: r, y: r },
  }
}

export function pieceGraphic(piece: Piece): PieceGraphic {
  switch (piece.kind) {
    case "rectangle":
      return rectangleGraphic(piece.widthMm, piece.heightMm)
    case "annularSector":
      return sectorGraphic(piece.innerRadiusMm, piece.outerRadiusMm, piece.angleRad)
    case "disc":
      return discGraphic(piece.diameterMm)
    case "polygon":
      return polygonGraphic(piece.sides, piece.circumradiusMm)
  }
}

/** Perpendicular registration ticks along a seam edge (for aligning joins). */
export function tickMarks(seg: Segment, count = 3, lengthMm = 4): Segment[] {
  const dx = seg.x2 - seg.x1
  const dy = seg.y2 - seg.y1
  const len = Math.hypot(dx, dy)
  if (len < 1e-9) return []
  const nx = (-dy / len) * (lengthMm / 2)
  const ny = (dx / len) * (lengthMm / 2)
  const ticks: Segment[] = []
  for (let i = 1; i <= count; i++) {
    const t = i / (count + 1)
    const cx = seg.x1 + dx * t
    const cy = seg.y1 + dy * t
    ticks.push({ x1: cx - nx, y1: cy - ny, x2: cx + nx, y2: cy + ny })
  }
  return ticks
}

export interface PlacedPiece {
  piece: Piece
  graphic: PieceGraphic
  dx: number
  dy: number
}

export interface TemplateLayout {
  placed: PlacedPiece[]
  widthMm: number
  heightMm: number
}

const GAP_MM = 18
/** vertical room under each piece for its dimension annotation */
export const ANNOTATION_MM = 10

/**
 * Shared text sizing between the on-screen preview and the printed PDF, so
 * what you see in-app is what prints. All three text elements a piece can
 * carry (project name, piece label, dimensions) are constrained to the
 * piece's own width — see textFits.
 */
export const LABEL_FONT_MM = 6
export const NAME_FONT_MM = 3.2
export const ANNOTATION_FONT_MM = 3.6

/**
 * Rough estimate of whether a text string rendered at fontSizeMm fits
 * within maxWidthMm. Used to decide whether to print something on a piece
 * at all — a small slab should stay blank rather than have text overflow
 * off its edges. Not pixel-perfect (average glyph width varies by font and
 * character), but conservative enough for a print-layout gate.
 */
export function textFits(text: string, fontSizeMm: number, maxWidthMm: number): boolean {
  if (text.length === 0) return true
  return text.length * fontSizeMm * 0.52 <= maxWidthMm
}

/** Stack pieces in a column — simple, predictable, and fine for a handful of pieces. */
export function layoutPieces(pieces: Piece[]): TemplateLayout {
  const placed: PlacedPiece[] = []
  let y = 0
  let maxW = 0
  for (const piece of pieces) {
    const graphic = pieceGraphic(piece)
    placed.push({ piece, graphic, dx: 0, dy: y })
    y += graphic.heightMm + ANNOTATION_MM + GAP_MM
    maxW = Math.max(maxW, graphic.widthMm)
  }
  return { placed, widthMm: maxW, heightMm: Math.max(0, y - GAP_MM) }
}

/* ---------------------------------------------------------------- paging */

export const PAPERS = {
  A4: { widthMm: 210, heightMm: 297 },
  Letter: { widthMm: 215.9, heightMm: 279.4 },
} as const

export type PaperSize = keyof typeof PAPERS

export const PAGE_MARGIN_MM = 12
export const PAGE_OVERLAP_MM = 10

export interface Pagination {
  cols: number
  rows: number
  /** printable area per page */
  printWidthMm: number
  printHeightMm: number
  /** distance between consecutive page origins (printable minus glue overlap) */
  stepWidthMm: number
  stepHeightMm: number
}

export function paginate(layoutWidthMm: number, layoutHeightMm: number, paper: PaperSize): Pagination {
  const { widthMm, heightMm } = PAPERS[paper]
  const printWidthMm = widthMm - 2 * PAGE_MARGIN_MM
  const printHeightMm = heightMm - 2 * PAGE_MARGIN_MM
  const stepWidthMm = printWidthMm - PAGE_OVERLAP_MM
  const stepHeightMm = printHeightMm - PAGE_OVERLAP_MM
  const cols = Math.max(1, Math.ceil((layoutWidthMm - PAGE_OVERLAP_MM) / stepWidthMm))
  const rows = Math.max(1, Math.ceil((layoutHeightMm - PAGE_OVERLAP_MM) / stepHeightMm))
  return { cols, rows, printWidthMm, printHeightMm, stepWidthMm, stepHeightMm }
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Everything a piece puts on paper: its outline plus the annotation row
 * under it. Text (name/label/dimensions) is always constrained to fit
 * within the piece's own width (see textFits) or omitted entirely, so it
 * never needs a wider box than the piece itself.
 */
function contentBoxes(layout: TemplateLayout): Box[] {
  return layout.placed.map(({ graphic, dx, dy }) => ({
    x: dx,
    y: dy,
    w: graphic.widthMm,
    h: graphic.heightMm + ANNOTATION_MM,
  }))
}

export interface Tile {
  row: number
  col: number
  /** layout-space origin of this tile's printable area */
  x0: number
  y0: number
}

/** Tiles of the page grid that actually contain content — the pages worth printing. */
export function contentTiles(layout: TemplateLayout, pg: Pagination): Tile[] {
  const boxes = contentBoxes(layout)
  const tiles: Tile[] = []
  for (let row = 0; row < pg.rows; row++) {
    for (let col = 0; col < pg.cols; col++) {
      const x0 = col * pg.stepWidthMm
      const y0 = row * pg.stepHeightMm
      const hit = boxes.some(
        (b) => b.x < x0 + pg.printWidthMm && b.x + b.w > x0 && b.y < y0 + pg.printHeightMm && b.y + b.h > y0
      )
      if (hit) tiles.push({ row, col, x0, y0 })
    }
  }
  return tiles
}

export interface PageCount {
  /** template tiles that actually print (empty tiles are skipped) */
  templatePages: number
  /** template pages plus the overview/instructions page */
  totalPages: number
  pagination: Pagination
}

/** The exact page count the PDF export produces. */
export function countPages(layout: TemplateLayout, paper: PaperSize): PageCount {
  const pagination = paginate(layout.widthMm, layout.heightMm, paper)
  const templatePages = contentTiles(layout, pagination).length
  return { templatePages, totalPages: templatePages + 1, pagination }
}
