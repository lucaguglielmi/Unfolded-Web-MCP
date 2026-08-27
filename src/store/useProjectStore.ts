import { create } from "zustand"
import {
  DEFAULT_CLAY,
  PRESETS,
  setClayInputSchema,
  updateFormInputSchema,
  type ClaySettings,
  type FormParams,
  type SetClayInput,
  type UpdateFormInput,
} from "@/lib/model/schemas"
import { buildPieces, describePiece, formWarnings, type Piece } from "@/lib/geometry/unroll"
import { countPages, layoutPieces, PAGE_OVERLAP_MM, type PaperSize } from "@/lib/export/svg"

export type AgentStatus = "native" | "unavailable"

export interface AgentCall {
  tool: string
  at: number
}

interface ProjectState {
  form: FormParams
  clay: ClaySettings
  paperSize: PaperSize
  agentStatus: AgentStatus
  lastAgentCall: AgentCall | null

  updateForm: (patch: UpdateFormInput) => void
  setClay: (patch: SetClayInput) => void
  applyPreset: (presetId: keyof typeof PRESETS) => void
  setPaperSize: (paper: PaperSize) => void
  setAgentStatus: (status: AgentStatus) => void
  recordAgentCall: (tool: string) => void
}

/**
 * Single source of truth. Both the UI and the WebMCP tools go through these
 * actions, so edits from a person and from their agent stay in sync in the
 * same session. Patches are validated/clamped by the zod schemas.
 */
export const useProjectStore = create<ProjectState>()((set) => ({
  form: PRESETS["classic-mug"],
  clay: DEFAULT_CLAY,
  paperSize: "A4",
  agentStatus: "unavailable",
  lastAgentCall: null,

  updateForm: (patch) =>
    set((state) => {
      const parsed = updateFormInputSchema.parse(patch)
      const form = { ...state.form, ...parsed }
      // A cylinder has one diameter: keep top mirroring bottom so switching
      // to 'tapered' starts from a sensible shape.
      if (form.type === "cylinder") {
        form.topDiameterMm = form.bottomDiameterMm
      }
      return { form }
    }),

  setClay: (patch) =>
    set((state) => ({ clay: { ...state.clay, ...setClayInputSchema.parse(patch) } })),

  applyPreset: (presetId) =>
    set(() => ({ form: { ...PRESETS[presetId] }, clay: { ...DEFAULT_CLAY } })),

  setPaperSize: (paperSize) => set({ paperSize }),
  setAgentStatus: (agentStatus) => set({ agentStatus }),
  recordAgentCall: (tool) => set({ lastAgentCall: { tool, at: Date.now() } }),
}))

export function selectPieces(form: FormParams, clay: ClaySettings): Piece[] {
  return buildPieces(form, clay)
}

/** Structured snapshot returned by read tools and after every mutation. */
export function describeState(): {
  form: FormParams
  clay: ClaySettings
  paperSize: PaperSize
  pieces: string[]
  printedPages: number
  warnings: string[]
} {
  const { form, clay, paperSize } = useProjectStore.getState()
  const pieces = buildPieces(form, clay)
  const pages = countPages(layoutPieces(pieces), paperSize)
  return {
    form,
    clay,
    paperSize,
    pieces: pieces.map(describePiece),
    printedPages: pages.totalPages,
    warnings: formWarnings(form, clay),
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
  const { form, clay, paperSize } = useProjectStore.getState()
  const pieces = buildPieces(form, clay)
  const layout = layoutPieces(pieces)
  const pages = countPages(layout, paperSize)
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
      dimensions: describePiece(p).replace(`${p.label}: `, ""),
      notes: p.notes,
    })),
    warnings: formWarnings(form, clay),
  }
}
