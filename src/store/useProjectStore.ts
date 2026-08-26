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
import { buildPieces, describePiece, type Piece } from "@/lib/geometry/unroll"

export type AgentStatus = "native" | "unavailable"

export interface AgentCall {
  tool: string
  at: number
}

interface ProjectState {
  form: FormParams
  clay: ClaySettings
  agentStatus: AgentStatus
  lastAgentCall: AgentCall | null

  updateForm: (patch: UpdateFormInput) => void
  setClay: (patch: SetClayInput) => void
  applyPreset: (presetId: keyof typeof PRESETS) => void
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
  pieces: string[]
} {
  const { form, clay } = useProjectStore.getState()
  return {
    form,
    clay,
    pieces: buildPieces(form, clay).map(describePiece),
  }
}
