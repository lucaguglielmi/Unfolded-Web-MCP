import type { ClaySettings, FormParams } from "@/lib/model/schemas"
import {
  buildPieces,
  capacityMl,
  describePiece,
  formWarnings,
  shrinkageScale,
  type Piece,
} from "@/lib/geometry/unroll"
import { countPages, layoutPieces, PAGE_OVERLAP_MM, type PaperSize } from "@/lib/export/svg"
import { shareUrl } from "@/lib/model/shareLink"
import type { Unit } from "@/lib/units"
import { useProjectStore } from "@/store/useProjectStore"

/**
 * Agent-facing serializers. These format the design FOR agents — the
 * structured snapshots the WebMCP tools return — so they live with the MCP
 * layer, not in the store. All lengths in the numeric fields stay
 * millimeters; only the human-readable strings follow the display unit.
 *
 * Pure: a snapshot never mints, prefetches, or spends a live-session
 * token. The permanent designUrl is the only link here; live handoff
 * links come from create_live_handoff alone (see liveHandoff.ts).
 */

/** Structured snapshot returned by read tools and after every mutation. */
export function describeState(): {
  form: FormParams
  clay: ClaySettings
  paperSize: PaperSize
  /** the potter's preferred display unit; all numeric fields stay in mm */
  units: Unit
  /** permanent permalink: reopens an independent copy — never a live session */
  designUrl: string
  linkMode: "independent-copy"
  /** the tool that mints a live continuation link, on demand */
  liveHandoffTool: "create_live_handoff"
  /** approximate fired interior volume in milliliters */
  capacityMl: number
  pieces: string[]
  printedPages: number
  warnings: string[]
} {
  const { form, clay, paperSize, unit } = useProjectStore.getState()
  const pieces = buildPieces(form, clay)
  const pages = countPages(layoutPieces(pieces, paperSize), paperSize)
  const scale = shrinkageScale(clay.shrinkagePct)
  return {
    form,
    clay,
    paperSize,
    units: unit,
    designUrl: shareUrl(form, clay, paperSize, { unit }),
    linkMode: "independent-copy",
    liveHandoffTool: "create_live_handoff",
    capacityMl: capacityMl(form, clay),
    pieces: pieces.map((p) => describePiece(p, scale, unit)),
    printedPages: pages.totalPages,
    warnings: formWarnings(form, clay, unit),
  }
}

/** Template-focused snapshot for get_template_summary — layout, pieces, paging. */
export function describeTemplates(): {
  paperSize: PaperSize
  pages: { overview: number; template: number; total: number; grid: string }
  layoutMm: { width: number; height: number }
  glueOverlapMm: number
  pieces: { label: string; kind: Piece["kind"]; dimensions: string; notes: string[] }[]
  warnings: string[]
} {
  const { form, clay, paperSize, unit } = useProjectStore.getState()
  const pieces = buildPieces(form, clay)
  const layout = layoutPieces(pieces, paperSize)
  const pages = countPages(layout, paperSize)
  const scale = shrinkageScale(clay.shrinkagePct)
  return {
    paperSize,
    pages: {
      overview: 1,
      template: pages.templatePages,
      total: pages.totalPages,
      grid: `${pages.pagination.rows}x${pages.pagination.cols}`,
    },
    layoutMm: {
      width: Number(layout.widthMm.toFixed(1)),
      height: Number(layout.heightMm.toFixed(1)),
    },
    glueOverlapMm: PAGE_OVERLAP_MM,
    pieces: pieces.map((p) => ({
      label: p.label,
      kind: p.kind,
      dimensions: describePiece(p, scale, unit).replace(`${p.label}: `, ""),
      notes: p.notes,
    })),
    warnings: formWarnings(form, clay, unit),
  }
}
