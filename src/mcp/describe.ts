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
import { takeJoinToken } from "./agentContinuity"
import { useProjectStore } from "@/store/useProjectStore"

/**
 * Agent-facing serializers. These format the design FOR agents — the
 * structured snapshots the WebMCP tools return — so they live with the MCP
 * layer, not in the store. All lengths in the numeric fields stay
 * millimeters; only the human-readable strings follow the display unit.
 */

/** Structured snapshot returned by read tools and after every mutation. */
export function describeState(): {
  form: FormParams
  clay: ClaySettings
  paperSize: PaperSize
  /** the potter's preferred display unit; all numeric fields stay in mm */
  units: Unit
  /** deep link that reopens exactly this design — share it with the potter */
  shareUrl: string
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
    // agent snapshots tag the link (?via=chatgpt) so an opening tab knows
    // it came through the agent's session — and carry a single-use join
    // token, so tapping it makes the visible tab a LIVE follower of this
    // (possibly hidden) one. Null token = plain link; the next result
    // carries a fresh one.
    shareUrl: shareUrl(form, clay, paperSize, {
      unit,
      viaChatGpt: useProjectStore.getState().agentStatus === "native",
      joinToken: takeJoinToken() ?? undefined,
    }),
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
