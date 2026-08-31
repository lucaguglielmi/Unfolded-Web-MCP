import { applyClayPatch, applyFormPatch } from "../src/lib/model/applyPatch"
import { sanitizeSharePatches, type SharePatches } from "../src/lib/model/shareLink"
import {
  claySettingsSchema,
  formParamsSchema,
  DEFAULT_CLAY,
  PRESETS,
  type ClaySettings,
  type FormParams,
} from "../src/lib/model/schemas"
import type { PaperSize } from "../src/lib/export/svg"
import type { Unit } from "../src/lib/units"

/**
 * The session's pure state machine — everything the SessionDO knows about a
 * design, with no Workers APIs in sight so plain vitest can pin it down.
 * Patches go through the SAME applyFormPatch/applyClayPatch the store uses,
 * so the canonical state can never drift from what a tab computes locally
 * (docs/live-sync-spec.md §7.1). The DO glue owns sockets, presence, and
 * persistence.
 */

export interface SessionState {
  form: FormParams
  clay: ClaySettings
  paperSize: PaperSize
  unit: Unit
}

export interface SessionSnapshot {
  state: SessionState
  version: number
  initialized: boolean
}

export type ApplyResult =
  | { ok: true; patches: SharePatches; version: number }
  | { ok: false; error: string }

const DEFAULT_STATE: SessionState = {
  form: PRESETS["classic-mug"],
  clay: DEFAULT_CLAY,
  paperSize: "A4",
  unit: "cm",
}

export class SessionCore {
  state: SessionState
  version: number
  /** false until a first client bootstraps the design (eager creation) */
  initialized: boolean

  constructor(restored?: SessionSnapshot) {
    this.state = restored?.state ?? { ...DEFAULT_STATE }
    this.version = restored?.version ?? 0
    this.initialized = restored?.initialized ?? false
  }

  /**
   * First-contact bootstrap: an eagerly created session adopts the FIRST
   * client's full design instead of welcoming it with a default mug. Only
   * a complete, in-contract slice is adopted; anything else leaves the
   * defaults (the session still works — it just starts from the default).
   * A no-op once initialized: after that the session's state is canonical.
   */
  bootstrap(raw: unknown): boolean {
    if (this.initialized) return false
    this.initialized = true
    const patches = sanitizeSharePatches(raw)
    if (!patches) return false
    const form = formParamsSchema.safeParse(patches.form)
    const clay = claySettingsSchema.safeParse(patches.clay)
    if (!form.success || !clay.success) return false
    this.state = {
      form: form.data,
      clay: clay.data,
      paperSize: patches.paperSize ?? DEFAULT_STATE.paperSize,
      unit: patches.unit ?? DEFAULT_STATE.unit,
    }
    return true
  }

  /**
   * Apply a client's patch to the canonical state. Success returns the
   * sanitized patches to broadcast (never the raw input) and the new
   * version; failure leaves state and version untouched.
   */
  apply(raw: unknown): ApplyResult {
    const patches = sanitizeSharePatches(raw)
    if (!patches) return { ok: false, error: "no recognizable design fields in patch" }
    try {
      const next: SessionState = {
        form: patches.form ? applyFormPatch(this.state.form, patches.form) : this.state.form,
        clay: patches.clay ? applyClayPatch(this.state.clay, patches.clay) : this.state.clay,
        paperSize: patches.paperSize ?? this.state.paperSize,
        unit: patches.unit ?? this.state.unit,
      }
      this.state = next
      this.initialized = true
      this.version += 1
      return { ok: true, patches, version: this.version }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: `patch rejected: ${message}` }
    }
  }

  snapshot(): SessionSnapshot {
    return { state: this.state, version: this.version, initialized: this.initialized }
  }
}
