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
import { buildPieces, describePiece, formWarnings, shrinkageScale, type Piece } from "@/lib/geometry/unroll"
import { countPages, layoutPieces, PAGE_OVERLAP_MM, type PaperSize } from "@/lib/export/svg"
import type { ExportResult } from "@/lib/export/pdf"
import { buildShareParams, parseShareParams, shareUrl, type SharePatches } from "@/lib/model/shareLink"

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
  isExporting: boolean
  exportError: string | null

  updateForm: (patch: UpdateFormInput) => void
  setClay: (patch: SetClayInput) => void
  /** Apply a share link's decoded patches (form + clay + paper) in one go. */
  openModel: (patches: SharePatches) => void
  applyPreset: (presetId: keyof typeof PRESETS) => void
  setPaperSize: (paper: PaperSize) => void
  setAgentStatus: (status: AgentStatus) => void
  recordAgentCall: (tool: string) => void
  /** Dismiss a stale export failure (e.g. when re-opening the export dialog). */
  clearExportError: () => void
  /** Shared by the desktop template panel and the mobile sticky export bar. */
  exportPdf: () => Promise<ExportResult>
}

/**
 * Single source of truth. Both the UI and the WebMCP tools go through these
 * actions, so edits from a person and from their agent stay in sync in the
 * same session. Patches are validated/clamped by the zod schemas.
 */
export const useProjectStore = create<ProjectState>()((set, get) => ({
  form: PRESETS["classic-mug"],
  clay: DEFAULT_CLAY,
  paperSize: "A4",
  agentStatus: "unavailable",
  lastAgentCall: null,
  isExporting: false,
  exportError: null,

  updateForm: (patch) =>
    set((state) => {
      const parsed = updateFormInputSchema.parse(patch)
      const form = { ...state.form, ...parsed }
      // Switching to 'tapered' from a straight form would otherwise start
      // with top === bottom — i.e. a preview that doesn't look tapered at
      // all. Unless the caller set an explicit top, flare it so the change
      // is immediately visible.
      const switchedToTapered = parsed.type === "tapered" && state.form.type !== "tapered"
      if (
        switchedToTapered &&
        parsed.topDiameterMm === undefined &&
        Math.abs(form.topDiameterMm - form.bottomDiameterMm) < 0.05
      ) {
        form.topDiameterMm = Math.min(300, Math.round(form.bottomDiameterMm * 1.4))
      }
      // Cylinder and faceted forms have one width: keep top mirroring bottom.
      if (form.type !== "tapered") {
        form.topDiameterMm = form.bottomDiameterMm
      }
      return { form }
    }),

  setClay: (patch) =>
    set((state) => ({ clay: { ...state.clay, ...setClayInputSchema.parse(patch) } })),

  openModel: (patches) => {
    const { updateForm, setClay, setPaperSize } = get()
    if (patches.form) updateForm(patches.form)
    if (patches.clay) setClay(patches.clay)
    if (patches.paperSize) setPaperSize(patches.paperSize)
  },

  applyPreset: (presetId) =>
    set(() => ({ form: { ...PRESETS[presetId] }, clay: { ...DEFAULT_CLAY } })),

  setPaperSize: (paperSize) => set({ paperSize }),
  setAgentStatus: (agentStatus) => set({ agentStatus }),
  recordAgentCall: (tool) => set({ lastAgentCall: { tool, at: Date.now() } }),
  clearExportError: () => set({ exportError: null }),

  exportPdf: async () => {
    set({ isExporting: true, exportError: null })
    try {
      const { form, clay, paperSize } = get()
      const pieces = buildPieces(form, clay)
      const { exportTemplatesPdf } = await import("@/lib/export/pdf")
      return await exportTemplatesPdf({
        pieces,
        name: form.name,
        paper: paperSize,
        scale: shrinkageScale(clay.shrinkagePct),
      })
    } catch (error) {
      set({ exportError: error instanceof Error ? error.message : String(error) })
      throw error
    } finally {
      set({ isExporting: false })
    }
  },
}))

export function selectPieces(form: FormParams, clay: ClaySettings): Piece[] {
  return buildPieces(form, clay)
}

/** Structured snapshot returned by read tools and after every mutation. */
export function describeState(): {
  form: FormParams
  clay: ClaySettings
  paperSize: PaperSize
  /** deep link that reopens exactly this design — share it with the potter */
  shareUrl: string
  pieces: string[]
  printedPages: number
  warnings: string[]
} {
  const { form, clay, paperSize } = useProjectStore.getState()
  const pieces = buildPieces(form, clay)
  const pages = countPages(layoutPieces(pieces), paperSize)
  const scale = shrinkageScale(clay.shrinkagePct)
  return {
    form,
    clay,
    paperSize,
    shareUrl: shareUrl(form, clay, paperSize),
    pieces: pieces.map((p) => describePiece(p, scale)),
    printedPages: pages.totalPages,
    warnings: formWarnings(form, clay),
  }
}

/**
 * Apply a share link from the address bar — call once at boot, before
 * first render, so a deep-linked design never flashes the default.
 */
export function applyShareLinkFromLocation(): void {
  if (typeof window === "undefined" || !window.location.search) return
  useProjectStore.getState().openModel(parseShareParams(window.location.search))
}

/**
 * Keep the address bar in sync with the design (debounced replaceState),
 * so the URL is always a live share link. A clean URL stays clean until
 * the first actual edit — visitors aren't surprised by a growing URL.
 */
export function startShareLinkSync(): void {
  if (typeof window === "undefined") return
  const currentQs = () => {
    const { form, clay, paperSize } = useProjectStore.getState()
    return buildShareParams(form, clay, paperSize).toString()
  }
  let last = currentQs()
  let timer: number | undefined
  useProjectStore.subscribe(() => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      const qs = currentQs()
      if (qs === last) return
      last = qs
      window.history.replaceState(null, "", `${window.location.pathname}?${qs}`)
    }, 350)
  })
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
      dimensions: describePiece(p, scale).replace(`${p.label}: `, ""),
      notes: p.notes,
    })),
    warnings: formWarnings(form, clay),
  }
}
