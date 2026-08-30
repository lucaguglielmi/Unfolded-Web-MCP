import { jsPDF } from "jspdf"
import "svg2pdf.js"
import type { Piece } from "@/lib/geometry/unroll"
import { describePiece } from "@/lib/geometry/unroll"
import {
  contentTiles,
  layoutPieces,
  paginate,
  textFits,
  tickMarks,
  ANNOTATION_FONT_MM,
  LABEL_FONT_MM,
  NAME_FONT_MM,
  PAGE_MARGIN_MM,
  PAGE_OVERLAP_MM,
  PAPERS,
  type PaperSize,
  type TemplateLayout,
} from "./svg"

/**
 * True-scale, multi-page PDF export. The template layout is tiled onto pages;
 * neighboring pages overlap by PAGE_OVERLAP_MM so the printouts can be glued.
 * Page 1 is an overview with assembly map + calibration rulers.
 *
 * No color anywhere in the template artwork — printers vary, ink isn't
 * always available, and cut vs. seam lines are already distinguished by
 * line style (solid vs. dashed), not hue.
 */

const SEAM_COLOR = "#57534e"
const OUTLINE_COLOR = "#1c1917"

const SVG_NS = "http://www.w3.org/2000/svg"

function el<K extends string>(name: K, attrs: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(SVG_NS, name)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v))
  return node
}

/**
 * Full layout as one SVG group: outlines, seams, ticks, and text. Each of
 * the three text elements (project name, piece label, dimensions) is only
 * drawn if it fits within the piece's own width — a small slab prints blank
 * rather than with text spilling off its edges.
 */
function layoutSvg(
  layout: TemplateLayout,
  viewBox: string,
  widthMm: number,
  heightMm: number,
  scale: number,
  projectName: string
): SVGSVGElement {
  const svg = el("svg", {
    xmlns: SVG_NS,
    viewBox,
    width: `${widthMm}mm`,
    height: `${heightMm}mm`,
  }) as SVGSVGElement

  for (const { piece, graphic, dx, dy } of layout.placed) {
    const g = el("g", { transform: `translate(${dx} ${dy})` })
    g.appendChild(
      el("path", { d: graphic.d, fill: "none", stroke: OUTLINE_COLOR, "stroke-width": 0.5 })
    )
    for (const seam of graphic.seams) {
      g.appendChild(
        el("line", {
          x1: seam.x1,
          y1: seam.y1,
          x2: seam.x2,
          y2: seam.y2,
          stroke: SEAM_COLOR,
          "stroke-width": 0.5,
          "stroke-dasharray": "4 2.5",
        })
      )
      for (const tick of tickMarks(seam)) {
        g.appendChild(
          el("line", {
            x1: tick.x1,
            y1: tick.y1,
            x2: tick.x2,
            y2: tick.y2,
            stroke: SEAM_COLOR,
            "stroke-width": 0.5,
          })
        )
      }
    }

    const availableWidth = graphic.widthMm

    if (textFits(projectName, NAME_FONT_MM, availableWidth)) {
      const name = el("text", {
        x: graphic.labelAt.x,
        y: graphic.labelAt.y - LABEL_FONT_MM * 0.6 - 1,
        "font-family": "helvetica",
        "font-size": NAME_FONT_MM,
        "text-anchor": "middle",
        fill: SEAM_COLOR,
      })
      name.textContent = projectName
      g.appendChild(name)
    }

    if (textFits(piece.label, LABEL_FONT_MM, availableWidth)) {
      const label = el("text", {
        x: graphic.labelAt.x,
        y: graphic.labelAt.y,
        "font-family": "helvetica",
        "font-size": LABEL_FONT_MM,
        "text-anchor": "middle",
        fill: OUTLINE_COLOR,
      })
      label.textContent = piece.label
      g.appendChild(label)
    }

    if (
      piece.kind === "rectangle" &&
      piece.stamp &&
      textFits(piece.stamp, NAME_FONT_MM, availableWidth)
    ) {
      const stamp = el("text", {
        x: graphic.labelAt.x,
        y: graphic.labelAt.y + LABEL_FONT_MM * 0.9 + 1,
        "font-family": "helvetica",
        "font-size": NAME_FONT_MM,
        "text-anchor": "middle",
        fill: SEAM_COLOR,
      })
      stamp.textContent = piece.stamp
      g.appendChild(stamp)
    }

    const dimsText = describePiece(piece, scale).replace(`${piece.label}: `, "")
    if (textFits(dimsText, ANNOTATION_FONT_MM, availableWidth)) {
      const dims = el("text", {
        x: 0,
        y: graphic.heightMm + ANNOTATION_FONT_MM + 2,
        "font-family": "helvetica",
        "font-size": ANNOTATION_FONT_MM,
        fill: SEAM_COLOR,
      })
      dims.textContent = dimsText
      g.appendChild(dims)
    }

    svg.appendChild(g)
  }
  return svg
}

function cropMarks(doc: jsPDF, x0: number, y0: number, w: number, h: number): void {
  const L = 5
  doc.setDrawColor(120)
  doc.setLineWidth(0.2)
  for (const [cx, cy, sx, sy] of [
    [x0, y0, 1, 1],
    [x0 + w, y0, -1, 1],
    [x0, y0 + h, 1, -1],
    [x0 + w, y0 + h, -1, -1],
  ] as const) {
    doc.line(cx, cy, cx + sx * L, cy)
    doc.line(cx, cy, cx, cy + sy * L)
  }
}

export interface ExportResult {
  pages: number
  cols: number
  rows: number
  paper: PaperSize
}

export async function exportTemplatesPdf(options: {
  pieces: Piece[]
  name: string
  paper: PaperSize
  /** shrinkageScale(clay.shrinkagePct) — used to print fired dimensions alongside wet ones */
  scale: number
}): Promise<ExportResult> {
  const { pieces, name, paper, scale } = options
  const layout = layoutPieces(pieces)
  const pg = paginate(layout.widthMm, layout.heightMm, paper)
  const { widthMm: pageW, heightMm: pageH } = PAPERS[paper]
  const M = PAGE_MARGIN_MM

  const doc = new jsPDF({ unit: "mm", format: paper === "A4" ? "a4" : "letter" })

  /* ------------------------------------------------------- overview page */
  doc.setFont("helvetica", "bold")
  doc.setFontSize(18)
  doc.text("Unfolded — slab template", M, M + 6)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(11)
  doc.text(`${name} — wet-clay template, shrinkage already applied`, M, M + 13)

  doc.setFontSize(10)
  const instructions = [
    "1. Print ALL pages at 100% scale (no 'fit to page').",
    "2. Check the calibration bars below with a ruler before cutting.",
    "3. Tape pages following the map; edges overlap by the glue strip (10 mm).",
    "4. Cut along solid outlines. Dashed edges are seams: bevel at the angle stamped on the piece, score and slip.",
    "5. Tick marks across seams are registration marks — align them when wrapping.",
  ]
  instructions.forEach((line, i) => doc.text(line, M, M + 24 + i * 6))

  // calibration bars
  let y = M + 60
  doc.setLineWidth(0.6)
  doc.setDrawColor(0)
  doc.line(M, y, M + 100, y)
  doc.line(M, y - 2, M, y + 2)
  doc.line(M + 100, y - 2, M + 100, y + 2)
  doc.setFontSize(9)
  doc.text("100 mm — must measure exactly 100 mm", M + 104, y + 1.5)
  y += 8
  doc.line(M, y, M + 25.4, y)
  doc.line(M, y - 2, M, y + 2)
  doc.line(M + 25.4, y - 2, M + 25.4, y + 2)
  doc.text("1 inch", M + 29.4, y + 1.5)

  // assembly map: page grid + piece outlines, scaled to fit
  y += 12
  doc.setFontSize(11)
  doc.text("Assembly map", M, y)
  y += 4
  const gridW = pg.cols * pg.stepWidthMm + PAGE_OVERLAP_MM
  const gridH = pg.rows * pg.stepHeightMm + PAGE_OVERLAP_MM
  const mapScale = Math.min((pageW - 2 * M) / gridW, (pageH - y - M - 6) / gridH, 0.35)
  doc.setLineWidth(0.2)
  for (let r = 0; r < pg.rows; r++) {
    for (let c = 0; c < pg.cols; c++) {
      const px = M + c * pg.stepWidthMm * mapScale
      const py = y + r * pg.stepHeightMm * mapScale
      doc.setDrawColor(150)
      doc.rect(px, py, pg.printWidthMm * mapScale, pg.printHeightMm * mapScale)
      doc.setFontSize(9)
      doc.setTextColor(100)
      doc.text(pageId(r, c), px + 2, py + 5)
      doc.setTextColor(0)
    }
  }
  const mapSvg = layoutSvg(
    layout,
    `0 0 ${gridW} ${gridH}`,
    gridW * mapScale,
    gridH * mapScale,
    scale,
    name
  )
  document.body.appendChild(mapSvg)
  try {
    await doc.svg(mapSvg, { x: M, y, width: gridW * mapScale, height: gridH * mapScale })
  } finally {
    mapSvg.remove()
  }

  /* ---------------------------------------------------------- tile pages */
  let pages = 1
  for (const { row: r, col: c, x0, y0 } of contentTiles(layout, pg)) {
      doc.addPage()
      pages++

      const tileSvg = layoutSvg(
        layout,
        `${x0} ${y0} ${pg.printWidthMm} ${pg.printHeightMm}`,
        pg.printWidthMm,
        pg.printHeightMm,
        scale,
        name
      )
      document.body.appendChild(tileSvg)
      try {
        await doc.svg(tileSvg, { x: M, y: M, width: pg.printWidthMm, height: pg.printHeightMm })
      } finally {
        tileSvg.remove()
      }

      cropMarks(doc, M, M, pg.printWidthMm, pg.printHeightMm)

      // glue strips: where the neighboring page overlaps this one
      doc.setDrawColor(150)
      doc.setLineWidth(0.2)
      doc.setLineDashPattern([2, 2], 0)
      if (c < pg.cols - 1) {
        const gx = M + pg.printWidthMm - PAGE_OVERLAP_MM
        doc.line(gx, M, gx, M + pg.printHeightMm)
      }
      if (r < pg.rows - 1) {
        const gy = M + pg.printHeightMm - PAGE_OVERLAP_MM
        doc.line(M, gy, M + pg.printWidthMm, gy)
      }
      doc.setLineDashPattern([], 0)

      doc.setFontSize(8)
      doc.setTextColor(100)
      doc.text(
        `Unfolded — ${name} — page ${pageId(r, c)} of ${pg.rows}x${pg.cols} — print at 100%`,
        M,
        pageH - 5
      )
      doc.setTextColor(0)
  }

  doc.save(`unfolded-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${paper.toLowerCase()}.pdf`)
  return { pages, cols: pg.cols, rows: pg.rows, paper }
}

function pageId(row: number, col: number): string {
  return `${String.fromCharCode(65 + row)}${col + 1}`
}
