import { create } from "zustand"
import {
  claySettingsSchema,
  DEFAULT_CLAY,
  formParamsSchema,
  normalizeLegacyFormPatch,
  PRESETS,
  setClayInputSchema,
  updateFormInputSchema,
  type ClaySettings,
  type FormParams,
  type SetClayInput,
  type UpdateFormInput,
} from "@/lib/model/schemas"
import { buildPieces, capacityMl, describePiece, formWarnings, shrinkageScale, type Piece } from "@/lib/geometry/unroll"
import { countPages, layoutPieces, PAGE_OVERLAP_MM, type PaperSize } from "@/lib/export/svg"
import type { ExportResult } from "@/lib/export/pdf"
import { buildShareParams, parseShareParams, shareUrl, type SharePatches } from "@/lib/model/shareLink"

/**
 * How this tab relates to an agent:
 * - "native": WebMCP is available HERE and tools registered — one live session.
 * - "chatgpt": no direct WebMCP, but the design arrived via an agent-minted
 *   link (?via=chatgpt), i.e. it is open in the internal browser of a
 *   ChatGPT conversation. Explicit signal only — never inferred from user
 *   agent, referrer, or being inside an in-app browser.
 * - "unavailable": neither could be confirmed.
 */
export type AgentStatus = "native" | "chatgpt" | "unavailable"

export interface AgentCall {
  tool: string
  at: number
}

/** One undo step: the design as it was before a change. */
interface Snapshot {
  form: FormParams
  clay: ClaySettings
  paperSize: PaperSize
}

const HISTORY_LIMIT = 50
/** changes landing within this window merge into one undo step (slider drags) */
const HISTORY_COALESCE_MS = 800
let lastHistoryPushAt = 0

/** test-only: forget the coalescing window so the next change starts a new undo step */
export function _resetHistoryCoalescing(): void {
  lastHistoryPushAt = 0
}

/* The pdf module is heavy (jsPDF + svg2pdf) and browser-only, so it's
   loaded lazily — and through this seam so unit tests can swap it out
   (vi.mock does not reliably intercept dynamic imports made from another
   module). */
interface PdfModule {
  exportTemplatesPdf: (options: {
    pieces: Piece[]
    name: string
    paper: PaperSize
    scale: number
    shareUrl?: string
  }) => Promise<ExportResult>
}
let importPdfModule: () => Promise<PdfModule> = () => import("@/lib/export/pdf")

/** test-only: replace the pdf module loader */
export function _setPdfModuleForTests(loader: () => Promise<PdfModule>): void {
  importPdfModule = loader
}

function pushHistory(state: { history: Snapshot[]; form: FormParams; clay: ClaySettings; paperSize: PaperSize }): Snapshot[] {
  const now = Date.now()
  if (now - lastHistoryPushAt < HISTORY_COALESCE_MS && state.history.length > 0) {
    return state.history
  }
  lastHistoryPushAt = now
  const next = [
    ...state.history,
    { form: state.form, clay: state.clay, paperSize: state.paperSize },
  ]
  return next.length > HISTORY_LIMIT ? next.slice(-HISTORY_LIMIT) : next
}

interface ProjectState {
  form: FormParams
  clay: ClaySettings
  paperSize: PaperSize
  agentStatus: AgentStatus
  /** where the host exposed the WebMCP API (shown on /webmcp), or null */
  agentApiLocation: string | null
  lastAgentCall: AgentCall | null
  /**
   * Number of PDF exports currently running. A counter, not a boolean:
   * the human and the agent can export concurrently, and the first to
   * finish must not re-enable the UI while the other is still running.
   * `isExporting` is `exportsInFlight > 0`.
   */
  exportsInFlight: number
  /** undo stack — snapshots taken before each change, oldest first */
  history: Snapshot[]
  /** redo stack — filled by undo, cleared by any new change */
  future: Snapshot[]

  updateForm: (patch: UpdateFormInput) => void
  setClay: (patch: SetClayInput) => void
  /** Apply a share link's decoded patches (form + clay + paper) in one go. */
  openModel: (patches: SharePatches) => void
  applyPreset: (presetId: keyof typeof PRESETS) => void
  setPaperSize: (paper: PaperSize) => void
  /** Revert the most recent change (form/clay/paper). Returns false when there is nothing to undo. */
  undo: () => boolean
  /** Re-apply the most recently undone change. Returns false when there is nothing to redo. */
  redo: () => boolean
  setAgentStatus: (status: AgentStatus) => void
  setAgentApiLocation: (location: string | null) => void
  recordAgentCall: (tool: string) => void
  /**
   * Shared by the export dialog and the WebMCP export tool. Rejects on
   * failure — each caller surfaces the error to its own actor (the dialog
   * locally to the human, the tool as an isError result to the agent), so
   * one actor's failure never leaks into the other's UI.
   */
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
  agentApiLocation: null,
  lastAgentCall: null,
  exportsInFlight: 0,
  history: [],
  future: [],

  updateForm: (patch) =>
    set((state) => {
      const parsed = updateFormInputSchema.parse(
        normalizeLegacyFormPatch(patch as Record<string, unknown>)
      )
      const form = { ...state.form, ...parsed }
      // Turning taper on from a straight form would otherwise start with
      // top === bottom — i.e. a preview that doesn't look tapered at all.
      // Unless the caller set an explicit top, flare it so the change is
      // immediately visible.
      const becameTapered = parsed.tapered === true && !state.form.tapered
      if (
        becameTapered &&
        parsed.topDiameterMm === undefined &&
        Math.abs(form.topDiameterMm - form.bottomDiameterMm) < 0.05
      ) {
        form.topDiameterMm = Math.min(300, Math.round(form.bottomDiameterMm * 1.4))
      }
      // Straight forms have one width: keep top mirroring bottom.
      if (!form.tapered) {
        form.topDiameterMm = form.bottomDiameterMm
      }
      // no-op patches shouldn't burn an undo step
      if ((Object.keys(form) as (keyof FormParams)[]).every((k) => form[k] === state.form[k])) {
        return {}
      }
      return { form, history: pushHistory(state), future: [] }
    }),

  setClay: (patch) =>
    set((state) => {
      const clay = { ...state.clay, ...setClayInputSchema.parse(patch) }
      if (clay.shrinkagePct === state.clay.shrinkagePct && clay.wallThicknessMm === state.clay.wallThicknessMm) {
        return {}
      }
      return { clay, history: pushHistory(state), future: [] }
    }),

  openModel: (patches) => {
    // the three nested actions land within the coalescing window, so a
    // whole opened link reverts as one undo step
    const { updateForm, setClay, setPaperSize } = get()
    if (patches.form) updateForm(patches.form)
    if (patches.clay) setClay(patches.clay)
    if (patches.paperSize) setPaperSize(patches.paperSize)
  },

  applyPreset: (presetId) =>
    set((state) => ({
      form: { ...PRESETS[presetId] },
      clay: { ...DEFAULT_CLAY },
      history: pushHistory(state),
      future: [],
    })),

  setPaperSize: (paperSize) =>
    set((state) =>
      paperSize === state.paperSize
        ? {}
        : { paperSize, history: pushHistory(state), future: [] }
    ),

  undo: () => {
    let undone = false
    set((state) => {
      const prev = state.history[state.history.length - 1]
      if (!prev) return {}
      undone = true
      // the next change after an undo always starts a fresh undo step
      lastHistoryPushAt = 0
      return {
        form: prev.form,
        clay: prev.clay,
        paperSize: prev.paperSize,
        history: state.history.slice(0, -1),
        future: [
          ...state.future,
          { form: state.form, clay: state.clay, paperSize: state.paperSize },
        ],
      }
    })
    return undone
  },

  redo: () => {
    let redone = false
    set((state) => {
      const next = state.future[state.future.length - 1]
      if (!next) return {}
      redone = true
      lastHistoryPushAt = 0
      const history = [
        ...state.history,
        { form: state.form, clay: state.clay, paperSize: state.paperSize },
      ]
      return {
        form: next.form,
        clay: next.clay,
        paperSize: next.paperSize,
        future: state.future.slice(0, -1),
        history: history.length > HISTORY_LIMIT ? history.slice(-HISTORY_LIMIT) : history,
      }
    })
    return redone
  },
  setAgentStatus: (agentStatus) => set({ agentStatus }),
  setAgentApiLocation: (agentApiLocation) => set({ agentApiLocation }),
  // A tool actually executing is definitive proof an agent is connected —
  // flip the badge too, regardless of how/when the host injected the API.
  recordAgentCall: (tool) =>
    set({ lastAgentCall: { tool, at: Date.now() }, agentStatus: "native" }),
  exportPdf: async () => {
    set((state) => ({ exportsInFlight: state.exportsInFlight + 1 }))
    try {
      const { form, clay, paperSize } = get()
      const pieces = buildPieces(form, clay)
      const { exportTemplatesPdf } = await importPdfModule()
      return await exportTemplatesPdf({
        pieces,
        name: form.name,
        paper: paperSize,
        scale: shrinkageScale(clay.shrinkagePct),
        // deliberately untagged: the printed QR outlives any chat session
        shareUrl: shareUrl(form, clay, paperSize),
      })
    } finally {
      set((state) => ({ exportsInFlight: Math.max(0, state.exportsInFlight - 1) }))
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
  /** approximate fired interior volume in milliliters */
  capacityMl: number
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
    // agent snapshots tag the link so a tab that opens it can show it is
    // connected through the agent's session (see AgentStatus)
    shareUrl: shareUrl(form, clay, paperSize, {
      viaChatGpt: useProjectStore.getState().agentStatus === "native",
    }),
    capacityMl: capacityMl(form, clay),
    pieces: pieces.map((p) => describePiece(p, scale)),
    printedPages: pages.totalPages,
    warnings: formWarnings(form, clay),
  }
}

/* ------------------------------------------------------- persistence */

const STORAGE_KEY = "unfolded:project:v1"

/**
 * Restore the last session's design from localStorage — call at boot,
 * BEFORE applyShareLinkFromLocation so an explicit share link always wins
 * over what was left lying around. Anything invalid or corrupted is
 * ignored field-by-field (schemas re-validate everything).
 */
export function loadPersistedProject(): void {
  if (typeof window === "undefined") return
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const data: unknown = JSON.parse(raw)
    if (typeof data !== "object" || data === null) return
    const record = data as Record<string, unknown>
    const form = formParamsSchema.safeParse(
      typeof record.form === "object" && record.form !== null
        ? normalizeLegacyFormPatch(record.form as Record<string, unknown>)
        : record.form
    )
    const clay = claySettingsSchema.safeParse(record.clay)
    const paperSize =
      record.paperSize === "A4" || record.paperSize === "Letter" ? record.paperSize : undefined
    useProjectStore.setState({
      ...(form.success ? { form: form.data } : {}),
      ...(clay.success ? { clay: clay.data } : {}),
      ...(paperSize ? { paperSize } : {}),
    })
  } catch {
    // corrupted storage or blocked localStorage — start fresh
  }
}

/** Save the design (debounced) so a mid-demo refresh doesn't lose work. */
export function startProjectPersistence(): void {
  if (typeof window === "undefined") return
  let timer: number | undefined
  useProjectStore.subscribe(() => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      try {
        const { form, clay, paperSize } = useProjectStore.getState()
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ form, clay, paperSize }))
      } catch {
        // quota exceeded or private mode — persistence is best-effort
      }
    }, 400)
  })
}

/**
 * Apply a share link from the address bar — call once at boot, before
 * first render, so a deep-linked design never flashes the default.
 */
export function applyShareLinkFromLocation(): void {
  if (typeof window === "undefined" || !window.location.search) return
  const search = window.location.search
  useProjectStore.getState().openModel(parseShareParams(search))
  // Agent-minted links carry via=chatgpt: an explicit signal that this
  // design is open in the internal browser of a ChatGPT conversation.
  // Direct WebMCP registration ("native") always outranks it.
  if (new URLSearchParams(search).get("via") === "chatgpt") {
    useProjectStore.setState((state) =>
      state.agentStatus === "native" ? {} : { agentStatus: "chatgpt" }
    )
  }
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
