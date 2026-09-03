import { create } from "zustand"
import { subscribeWithSelector } from "zustand/middleware"
import {
  DEFAULT_CLAY,
  PRESETS,
  type ClaySettings,
  type FormParams,
  type SetClayInput,
  type UpdateFormInput,
} from "@/lib/model/schemas"
import { applyClayPatch, applyFormPatch } from "@/lib/model/applyPatch"
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
/**
 * Fallback coalescing window. Pointer drags and link opens use explicit
 * begin/endUndoCoalescing scopes (exact, timing-independent); this window
 * only merges what has no gesture boundary — held-down arrow keys on a
 * slider, or agent tools issuing rapid successive edits.
 */
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
  /** the next change starts a fresh step regardless of the time window */
  let forceNextStep = true
  /** >0 while inside an explicit coalescing scope (a drag, a link open) */
  let coalesceDepth = 0
  /** whether the current scope has taken its one snapshot already */
  let scopeSnapshotTaken = false

  function pushHistory(state: { history: Snapshot[]; form: FormParams; clay: ClaySettings; paperSize: PaperSize }): Snapshot[] {
    if (coalesceDepth > 0) {
      // explicit scope: exactly one snapshot (the state before the gesture)
      if (scopeSnapshotTaken) return state.history
      scopeSnapshotTaken = true
    } else if (
      !forceNextStep &&
      now() - lastHistoryPushAt < HISTORY_COALESCE_MS &&
      state.history.length > 0
    ) {
      return state.history
    }
    forceNextStep = false
    lastHistoryPushAt = now()
    const next = [
      ...state.history,
      { form: state.form, clay: state.clay, paperSize: state.paperSize },
    ]
    return next.length > HISTORY_LIMIT ? next.slice(-HISTORY_LIMIT) : next
  }

  function beginScope() {
    coalesceDepth += 1
    if (coalesceDepth === 1) scopeSnapshotTaken = false
  }

  function endScope() {
    coalesceDepth = Math.max(0, coalesceDepth - 1)
    // whatever follows a finished gesture is a new undo step
    if (coalesceDepth === 0) forceNextStep = true
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
    /**
     * Explicit undo-coalescing scope: every change between begin and end
     * reverts as ONE step, however long the gesture takes. Drives slider
     * drags (pointer-down → commit); openModel and applyPreset scope
     * themselves. Nestable; ending the outermost scope also ends the
     * time-window fallback so the next change starts a fresh step.
     */
    beginUndoCoalescing: () => void
    endUndoCoalescing: () => void
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
    exportPdf: (paperOverride?: PaperSize) => Promise<ExportResult>
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
        // validation, legacy normalization, and the taper/mirror invariants
        // all live in applyFormPatch — shared with the live-sync server
        const form = applyFormPatch(state.form, patch)
        // no-op patches shouldn't burn an undo step
        if ((Object.keys(form) as (keyof FormParams)[]).every((k) => form[k] === state.form[k])) {
          return {}
        }
        return { form, history: pushHistory(state), future: [] }
      }),

    setClay: (patch) =>
      set((state) => {
        const clay = applyClayPatch(state.clay, patch)
        if (clay.shrinkagePct === state.clay.shrinkagePct && clay.wallThicknessMm === state.clay.wallThicknessMm) {
          return {}
        }
        return { clay, history: pushHistory(state), future: [] }
      }),

    openModel: (patches) => {
      // one explicit scope: a whole opened link reverts as one undo step,
      // whatever the timing (the unit preference is a display setting and
      // stays out of history entirely)
      beginScope()
      try {
        const { updateForm, setClay, setPaperSize, setUnit } = get()
        if (patches.form) updateForm(patches.form)
        if (patches.clay) setClay(patches.clay)
        if (patches.paperSize) setPaperSize(patches.paperSize)
        if (patches.unit) setUnit(patches.unit)
      } finally {
        endScope()
      }
    },

    applyPreset: (presetId) => {
      // self-scoped: a preset is one deliberate step, and whatever the
      // potter does right after it is the next one
      beginScope()
      try {
        set((state) => ({
          form: { ...PRESETS[presetId] },
          clay: { ...DEFAULT_CLAY },
          history: pushHistory(state),
          future: [],
        }))
      } finally {
        endScope()
      }
    },

    setPaperSize: (paperSize) =>
      set((state) =>
        paperSize === state.paperSize
          ? {}
          : { paperSize, history: pushHistory(state), future: [] }
      ),

    setUnit: (unit) => set({ unit }),

    beginUndoCoalescing: beginScope,
    endUndoCoalescing: endScope,

    undo: () => {
      let undone = false
      set((state) => {
        const prev = state.history[state.history.length - 1]
        if (!prev) return {}
        undone = true
        // the next change after an undo always starts a fresh undo step
        forceNextStep = true
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
        forceNextStep = true
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
    exportPdf: async (paperOverride) => {
      set((state) => ({ exportsInFlight: state.exportsInFlight + 1 }))
      try {
        const { form, clay, paperSize: currentPaperSize, unit } = get()
        const paperSize = paperOverride ?? currentPaperSize
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
