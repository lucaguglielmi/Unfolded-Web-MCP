import { jsPDF } from "jspdf"
import "svg2pdf.js"
import { LOGO_SLAB_PATHS, LOGO_VIEWBOX } from "@/components/LogoMark"
import type { Piece } from "@/lib/geometry/unroll"
import { describePiece } from "@/lib/geometry/unroll"
import { MM_PER_INCH, type Unit } from "@/lib/units"
import {
  contentTiles,
  layoutPieces,
  paginate,
  textFits,
  tickMarks,
  ANNOTATION_FONT_MM,
  ANNOTATION_OFFSET_MM,
  LABEL_FONT_MM,
  NAME_FONT_MM,
  NAME_OFFSET_MM,
  PAGE_MARGIN_MM,
  PAGE_OVERLAP_MM,
  PAPERS,
  STAMP_FONT_MM,
  STAMP_OFFSET_MM,
  type PaperSize,
  type TemplateLayout,
} from "./svg"

/**
 * True-scale, multi-page PDF export. The template layout is tiled onto pages;
 * neighboring pages overlap by PAGE_OVERLAP_MM so the printouts can be glued.
 * Page 1 is an overview with assembly map + calibration rulers.
 *
 * No color in the template artwork itself — printers vary, ink isn't
 * always available, and cut vs. seam lines are already distinguished by
 * line style (solid vs. dashed), not hue. The overview's assembly map is
 * the one exception: it's purely illustrative (never measured or cut), so
 * it uses color and heavier lines to be readable at a glance.
 */

const SEAM_COLOR = "#57534e"
const OUTLINE_COLOR = "#1c1917"

/* assembly-map palette: light blue for the paper sheets, clay tones for
   the piece silhouettes laid across them */
const MAP_PAGE_FILL = "#e9f2fa"
const MAP_PAGE_STROKE = "#8ab8dc"
const MAP_PAGE_ID = "#2e6f9e"
const MAP_PIECE_FILL = "#e9dbcb"
const MAP_PIECE_STROKE = "#7a5c42"
const MAP_SEAM = "#b08968"
const MAP_EMPTY = "#c8c3bd"
/* gap between the sheets in the map — they're separate pages, show it */
const MAP_GAP_MM = 2.5

const SVG_NS = "http://www.w3.org/2000/svg"

function el<K extends string>(name: K, attrs: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(SVG_NS, name)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v))
  return node
}

/* grayscale slab fills for template-page margins (chrome stays ink-safe
   there; the overview page gets the real cobalt) */
const LOGO_MONO_FILLS = ["#555555", "#111111", "#333333"]

/** total viewBox width in mark units, with and without the wordmark
    (helvetica bold runs wider than the brand font — leave room) */
const LOGO_UNITS_MARK = LOGO_VIEWBOX.w
const LOGO_UNITS_FULL = 790

/** logo lockup width in mm for a given icon height */
function logoWidthMm(iconMm: number, withWordmark = true): number {
  return (iconMm * (withWordmark ? LOGO_UNITS_FULL : LOGO_UNITS_MARK)) / LOGO_VIEWBOX.h
}

/**
 * The Unfolded logomark (three folded slabs) + wordmark as an SVG element
 * sized to iconMm tall, for placing on PDF pages via doc.svg().
 * Returns [element, totalWidthMm].
 */
function logoSvg(iconMm: number, withWordmark = true, monochrome = false): [SVGSVGElement, number] {
  const totalUnits = withWordmark ? LOGO_UNITS_FULL : LOGO_UNITS_MARK
  const totalW = logoWidthMm(iconMm, withWordmark)
  const svg = el("svg", {
    xmlns: SVG_NS,
    viewBox: `${LOGO_VIEWBOX.x} ${LOGO_VIEWBOX.y} ${totalUnits} ${LOGO_VIEWBOX.h}`,
    width: `${totalW}mm`,
    height: `${iconMm}mm`,
  }) as SVGSVGElement
  LOGO_SLAB_PATHS.forEach((p, i) => {
    svg.appendChild(el("path", { d: p.d, fill: monochrome ? LOGO_MONO_FILLS[i] : p.fill }))
  })
  if (withWordmark) {
    const text = el("text", {
      x: 318,
      y: 166,
      "font-family": "helvetica",
      "font-size": 108,
      "font-weight": "bold",
      "letter-spacing": -5.5,
      fill: monochrome ? "#111111" : "#111827",
    })
    text.textContent = "unfolded"
    svg.appendChild(text)
  }
  return [svg, totalW]
}

/**
 * A scale-check bar drawn with plain jsPDF lines — 3 cm in metric mode,
 * 1 inch in imperial. One goes on every printed page so any page can be
 * validated against a ruler: if the bar measures true, that page printed
 * at true size.
 */
function drawScaleCheck(doc: jsPDF, xRight: number, y: number, unit: Unit): void {
  const lengthMm = unit === "in" ? MM_PER_INCH : 30
  const label = unit === "in" ? "1 in check" : "3 cm check"
  const x0 = xRight - lengthMm
  doc.setDrawColor(0)
  doc.setLineWidth(0.4)
  doc.line(x0, y, xRight, y)
  doc.line(x0, y - 1.5, x0, y + 1.5)
  doc.line(xRight, y - 1.5, xRight, y + 1.5)
  doc.setFontSize(7)
  doc.setTextColor(60)
  doc.text(label, x0 - 2, y + 1, { align: "right" })
  doc.setTextColor(0)
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
  projectName: string,
  unit: Unit
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

    const availableWidth = graphic.textWidthMm ?? graphic.widthMm

    // uppercase runs wider than the mixed-case average, hence the 1.15 factor
    if (textFits(projectName, NAME_FONT_MM * 1.15, availableWidth)) {
      const name = el("text", {
        x: graphic.labelAt.x,
        y: graphic.labelAt.y - NAME_OFFSET_MM,
        "font-family": "helvetica",
        "font-size": NAME_FONT_MM,
        "text-anchor": "middle",
        "letter-spacing": 0.3,
        fill: SEAM_COLOR,
      })
      name.textContent = projectName.toUpperCase()
      g.appendChild(name)
    }

    if (textFits(piece.label, LABEL_FONT_MM, availableWidth)) {
      const label = el("text", {
        x: graphic.labelAt.x,
        y: graphic.labelAt.y,
        "font-family": "helvetica",
        "font-size": LABEL_FONT_MM,
        "font-weight": "bold",
        "text-anchor": "middle",
        fill: OUTLINE_COLOR,
      })
      label.textContent = piece.label
      g.appendChild(label)
    }

    if (
      (piece.kind === "rectangle" || piece.kind === "trapezoid") &&
      piece.stamp &&
      textFits(piece.stamp, STAMP_FONT_MM, availableWidth)
    ) {
      const stamp = el("text", {
        x: graphic.labelAt.x,
        y: graphic.labelAt.y + STAMP_OFFSET_MM,
        "font-family": "helvetica",
        "font-size": STAMP_FONT_MM,
        "text-anchor": "middle",
        fill: SEAM_COLOR,
      })
      stamp.textContent = piece.stamp
      g.appendChild(stamp)
    }

    const dimsText = describePiece(piece, scale, unit).replace(`${piece.label}: `, "")
    if (textFits(dimsText, ANNOTATION_FONT_MM, availableWidth)) {
      const dims = el("text", {
        x: graphic.widthMm / 2,
        y: graphic.heightMm + ANNOTATION_OFFSET_MM,
        "font-family": "helvetica",
        "font-size": ANNOTATION_FONT_MM,
        "text-anchor": "middle",
        fill: SEAM_COLOR,
      })
      dims.textContent = dimsText
      g.appendChild(dims)
    }

    svg.appendChild(g)
  }
  return svg
}

/**
 * One assembly-map sheet's artwork: the piece silhouettes that land on that
 * page — filled clay tones, heavier outlines, no text or registration
 * ticks. At map scale (≤0.35x) the template pages' fine linework and labels
 * would collapse into noise; the map only has to show where each piece
 * lands. Artwork is explicitly clipped to the viewBox so a piece never
 * bleeds past its sheet into the gaps between pages.
 */
let mapClipCounter = 0
function assemblyMapSvg(
  layout: TemplateLayout,
  viewBox: string,
  widthMm: number,
  heightMm: number
): SVGSVGElement {
  const svg = el("svg", {
    xmlns: SVG_NS,
    viewBox,
    width: `${widthMm}mm`,
    height: `${heightMm}mm`,
  }) as SVGSVGElement

  const [vx, vy, vw, vh] = viewBox.split(" ").map(Number)
  const clipId = `unfolded-map-clip-${mapClipCounter++}`
  const defs = el("defs", {})
  const clip = el("clipPath", { id: clipId })
  clip.appendChild(el("rect", { x: vx, y: vy, width: vw, height: vh }))
  defs.appendChild(clip)
  svg.appendChild(defs)
  const clipped = el("g", { "clip-path": `url(#${clipId})` })

  for (const { graphic, dx, dy } of layout.placed) {
    const g = el("g", { transform: `translate(${dx} ${dy})` })
    g.appendChild(
      el("path", {
        d: graphic.d,
        fill: MAP_PIECE_FILL,
        stroke: MAP_PIECE_STROKE,
        "stroke-width": 2,
        "stroke-linejoin": "round",
      })
    )
    for (const seam of graphic.seams) {
      g.appendChild(
        el("line", {
          x1: seam.x1,
          y1: seam.y1,
          x2: seam.x2,
          y2: seam.y2,
          stroke: MAP_SEAM,
          "stroke-width": 1.2,
          "stroke-dasharray": "6 4",
        })
      )
    }
    clipped.appendChild(g)
  }
  svg.appendChild(clipped)
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
  /** display unit for every printed dimension and the per-page scale check */
  unit?: Unit
  /** deep link to this exact design — printed as a QR on the overview so the paper can reopen the model */
  shareUrl?: string
}): Promise<ExportResult> {
  const { pieces, name, paper, scale, shareUrl, unit = "cm" } = options
  const layout = layoutPieces(pieces, paper)
  const pg = paginate(layout.widthMm, layout.heightMm, paper)
  const { widthMm: pageW, heightMm: pageH } = PAPERS[paper]
  const M = PAGE_MARGIN_MM

  const doc = new jsPDF({ unit: "mm", format: paper.toLowerCase() })

  const placeLogo = async (
    iconMm: number,
    x: number,
    yTop: number,
    withWordmark = true,
    monochrome = false
  ) => {
    const [svg, w] = logoSvg(iconMm, withWordmark, monochrome)
    document.body.appendChild(svg)
    try {
      await doc.svg(svg, { x, y: yTop, width: w, height: iconMm })
    } finally {
      svg.remove()
    }
    return w
  }

  /* ------------------------------------------------------- overview page */
  await placeLogo(9, M, M - 2)

  // QR of the design's share link, top-right: weeks later in the studio,
  // scanning the printout reopens this exact parametric model to tweak or
  // reprint. Strictly a nicety — never let it break an export.
  if (shareUrl) {
    try {
      const { toDataURL } = await import("qrcode")
      const qrPng = await toDataURL(shareUrl, {
        margin: 0,
        width: 256,
        // H-level error correction leaves room for the logomark in the middle
        errorCorrectionLevel: "H",
        color: { dark: "#1c1917", light: "#ffffff" },
      })
      const QR_MM = 22
      const qrX = pageW - M - QR_MM
      const qrY = M - 2
      doc.addImage(qrPng, "PNG", qrX, qrY, QR_MM, QR_MM)
      // the unfolded mark, sitting on a small white pad at the QR's center
      const markH = 4.6
      const markW = (markH * LOGO_VIEWBOX.w) / LOGO_VIEWBOX.h
      doc.setFillColor("#ffffff")
      doc.roundedRect(
        qrX + QR_MM / 2 - markW / 2 - 0.8,
        qrY + QR_MM / 2 - markH / 2 - 0.8,
        markW + 1.6,
        markH + 1.6,
        0.6,
        0.6,
        "F"
      )
      await placeLogo(markH, qrX + QR_MM / 2 - markW / 2, qrY + QR_MM / 2 - markH / 2, false)
      doc.setFontSize(7)
      doc.setTextColor(120)
      doc.text("scan to reopen", pageW - M - QR_MM / 2, M + QR_MM + 2, { align: "center" })
      doc.text("this design", pageW - M - QR_MM / 2, M + QR_MM + 5, { align: "center" })
      doc.setTextColor(0)
    } catch {
      // offline QR lib failure — the link still lives in the app
    }
  }

  doc.setFont("helvetica", "bold")
  doc.setFontSize(15)
  doc.text("Slab template", M, M + 15)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(11)
  doc.text(`${name} — wet-clay template, shrinkage already applied`, M, M + 21)

  doc.setFontSize(10)
  const instructions = [
    "1. Print ALL pages at 100% scale (no 'fit to page').",
    `2. Check the calibration bars below with a ruler — every template page also carries a ${unit === "in" ? "1 in" : "3 cm"} check.`,
    "3. Tape pages following the map; edges overlap by the glue strip (10 mm).",
    "4. Cut along solid outlines. Dashed edges are seams: bevel at the angle stamped on the piece, score and slip.",
    "5. Tick marks across seams are registration marks — align them when wrapping.",
  ]
  instructions.forEach((line, i) => doc.text(line, M, M + 31 + i * 6))

  // calibration bars
  let y = M + 67
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

  // assembly map: every sheet of paper drawn as its own light-blue,
  // slightly rounded page, separated by a small gap — these are separate
  // printouts, not one connected surface. Each sheet shows just its own
  // slice of the artwork (edge content repeating on a neighbour is the
  // glue overlap), with its page id centered on the sheet so it can never
  // be cut off by a piece or a page edge. Purely illustrative — color and
  // weight never appear on the template pages.
  y += 12
  doc.setFontSize(11)
  doc.text("Assembly map", M, y)
  doc.setFontSize(8)
  doc.setTextColor(130)
  doc.text("blue pages print — dashed cells are skipped", M + 30, y)
  doc.setTextColor(0)
  y += 4
  const tiles = contentTiles(layout, pg)
  const printedTiles = new Set(tiles.map((t) => `${t.row}:${t.col}`))
  const mapScale = Math.min(
    (pageW - 2 * M - (pg.cols - 1) * MAP_GAP_MM) / (pg.cols * pg.printWidthMm),
    (pageH - y - M - 6 - (pg.rows - 1) * MAP_GAP_MM) / (pg.rows * pg.printHeightMm),
    0.35
  )
  const tileW = pg.printWidthMm * mapScale
  const tileH = pg.printHeightMm * mapScale
  const corner = Math.min(1.8, tileW / 6, tileH / 6)
  for (let r = 0; r < pg.rows; r++) {
    for (let c = 0; c < pg.cols; c++) {
      const px = M + c * (tileW + MAP_GAP_MM)
      const py = y + r * (tileH + MAP_GAP_MM)
      const prints = printedTiles.has(`${r}:${c}`)
      if (!prints) {
        doc.setDrawColor(MAP_EMPTY)
        doc.setLineWidth(0.3)
        doc.setLineDashPattern([1.5, 1.5], 0)
        doc.roundedRect(px, py, tileW, tileH, corner, corner, "S")
        doc.setLineDashPattern([], 0)
        doc.setFontSize(9)
        doc.setFont("helvetica", "normal")
        doc.setTextColor(MAP_EMPTY)
        doc.text(pageId(r, c), px + tileW / 2, py + tileH / 2 + 1.3, { align: "center" })
        continue
      }
      doc.setFillColor(MAP_PAGE_FILL)
      doc.setDrawColor(MAP_PAGE_STROKE)
      doc.setLineWidth(0.4)
      doc.roundedRect(px, py, tileW, tileH, corner, corner, "FD")
      const sheetSvg = assemblyMapSvg(
        layout,
        `${c * pg.stepWidthMm} ${r * pg.stepHeightMm} ${pg.printWidthMm} ${pg.printHeightMm}`,
        tileW,
        tileH
      )
      document.body.appendChild(sheetSvg)
      try {
        await doc.svg(sheetSvg, { x: px, y: py, width: tileW, height: tileH })
      } finally {
        sheetSvg.remove()
      }
      doc.setFontSize(10.5)
      doc.setFont("helvetica", "bold")
      doc.setTextColor(MAP_PAGE_ID)
      doc.text(pageId(r, c), px + tileW / 2, py + tileH / 2 + 1.4, { align: "center" })
    }
  }
  doc.setFont("helvetica", "normal")
  doc.setTextColor(0)
  doc.setDrawColor(0)

  /* ---------------------------------------------------------- tile pages */
  let pages = 1
  for (const { row: r, col: c, x0, y0 } of tiles) {
      doc.addPage()
      pages++

      const tileSvg = layoutSvg(
        layout,
        `${x0} ${y0} ${pg.printWidthMm} ${pg.printHeightMm}`,
        pg.printWidthMm,
        pg.printHeightMm,
        scale,
        name,
        unit
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

      // page chrome in the margin bands: logo top-right (grayscale — the
      // template pages stay ink-safe), footer text bottom-left, and a
      // 3 cm scale check bottom-right on every page
      await placeLogo(6, pageW - M - logoWidthMm(6), 2.5, true, true)
      doc.setFontSize(8)
      doc.setTextColor(100)
      const footerName = name.length > 40 ? `${name.slice(0, 37)}…` : name
      doc.text(
        `${footerName} — page ${pageId(r, c)} of ${pg.rows}x${pg.cols} — print at 100%`,
        M,
        pageH - 5
      )
      doc.setTextColor(0)
      drawScaleCheck(doc, pageW - M, pageH - 6, unit)
  }

  doc.save(`unfolded-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${paper.toLowerCase()}.pdf`)
  return { pages, cols: pg.cols, rows: pg.rows, paper }
}

function pageId(row: number, col: number): string {
  return `${String.fromCharCode(65 + row)}${col + 1}`
}
