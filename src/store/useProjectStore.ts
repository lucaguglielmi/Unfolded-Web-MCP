import { create } from "zustand"
import { subscribeWithSelector } from "zustand/middleware"
import {
  DEFAULT_CLAY,
  normalizeLegacyFormPatch,
  PRESETS,
  setClayInputSchema,
  updateFormInputSchema,
  type ClaySettings,
  type FormParams,
  type SetClayInput,
  type UpdateFormInput,
} from "@/lib/model/schemas"
import { buildPieces, shrinkageScale, type Piece } from "@/lib/geometry/unroll"
import type { PaperSize } from "@/lib/export/svg"
import type { ExportResult } from "@/lib/export/pdf"
import { shareUrl, type SharePatches } from "@/lib/model/shareLink"
import type { Unit } from "@/lib/units"

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

/* The pdf module is heavy (jsPDF + svg2pdf) and browser-only, so it's
   loaded lazily — and through this seam so unit tests can swap it out
   (vi.mock does not reliably intercept dynamic imports made from another
   module). Derived from the real module so the two can never drift. */
type PdfModule = Pick<typeof import("@/lib/export/pdf"), "exportTemplatesPdf">

export interface ProjectStoreDeps {
  /** clock for undo coalescing — tests inject a fake to control time */
  now?: () => number
  /** lazy pdf-module loader — tests inject a stub */
  loadPdfModule?: () => Promise<PdfModule>
}

/**
 * Store factory. The app uses the one `useProjectStore` singleton below;
 * tests build fresh, isolated instances with an injected clock or pdf
 * loader instead of resetting shared module state.
 */
export function createProjectStore({
  now = Date.now,
  loadPdfModule = () => import("@/lib/export/pdf"),
}: ProjectStoreDeps = {}) {
  let lastHistoryPushAt = 0

  function pushHistory(state: { history: Snapshot[]; form: FormParams; clay: ClaySettings; paperSize: PaperSize }): Snapshot[] {
    const t = now()
    if (t - lastHistoryPushAt < HISTORY_COALESCE_MS && state.history.length > 0) {
      return state.history
    }
    lastHistoryPushAt = t
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
    /** preferred DISPLAY unit — the model and tool I/O stay in millimeters */
    unit: Unit
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
    /** display preference only — not part of the undo history */
    setUnit: (unit: Unit) => void
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

  return create<ProjectState>()(subscribeWithSelector((set, get) => ({
    form: PRESETS["classic-mug"],
    clay: DEFAULT_CLAY,
    paperSize: "A4",
    unit: "cm",
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
      // the nested actions land within the coalescing window, so a whole
      // opened link reverts as one undo step (the unit preference is a
      // display setting and stays out of history entirely)
      const { updateForm, setClay, setPaperSize, setUnit } = get()
      if (patches.form) updateForm(patches.form)
      if (patches.clay) setClay(patches.clay)
      if (patches.paperSize) setPaperSize(patches.paperSize)
      if (patches.unit) setUnit(patches.unit)
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

    setUnit: (unit) => set({ unit }),

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
        const { form, clay, paperSize, unit } = get()
        const pieces = buildPieces(form, clay)
        const { exportTemplatesPdf } = await loadPdfModule()
        return await exportTemplatesPdf({
          pieces,
          name: form.name,
          paper: paperSize,
          scale: shrinkageScale(clay.shrinkagePct),
          unit,
          // deliberately untagged: the printed QR outlives any chat session
          shareUrl: shareUrl(form, clay, paperSize, { unit }),
        })
      } finally {
        set((state) => ({ exportsInFlight: Math.max(0, state.exportsInFlight - 1) }))
      }
    },
    })))
}

/**
 * Single source of truth. Both the UI and the WebMCP tools go through this
 * one instance's actions, so edits from a person and from their agent stay
 * in sync in the same session. Patches are validated/clamped by the zod
 * schemas.
 */
export const useProjectStore = createProjectStore()

export type ProjectStore = ReturnType<typeof createProjectStore>


export function selectPieces(form: FormParams, clay: ClaySettings): Piece[] {
  return buildPieces(form, clay)
}
