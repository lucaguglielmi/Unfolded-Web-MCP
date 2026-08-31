import {
  normalizeLegacyFormPatch,
  setClayInputSchema,
  updateFormInputSchema,
  type ClaySettings,
  type FormParams,
  type SetClayInput,
  type UpdateFormInput,
} from "./schemas"

/**
 * Pure patch application for the design model — validate, merge, and keep
 * the form's invariants. The store's `updateForm`/`setClay` are thin
 * wrappers around these (adding undo history), and the live-sync server
 * applies peers' patches through the SAME functions, so a synced session
 * can never drift from what a tab computes locally.
 *
 * Throws ZodError on out-of-contract input, exactly like the schemas the
 * WebMCP tools already surface as isError results.
 */

/** Two sizes this close count as equal — same epsilon the UI sliders snap within. */
const SIZE_EPSILON_MM = 0.05

export function applyFormPatch(current: FormParams, patch: UpdateFormInput): FormParams {
  const parsed = updateFormInputSchema.parse(
    normalizeLegacyFormPatch(patch as Record<string, unknown>)
  )
  const form = { ...current, ...parsed }
  // Turning taper on from a straight form would otherwise start with
  // top === bottom — i.e. a preview that doesn't look tapered at all.
  // Unless the caller set an explicit top, flare it so the change is
  // immediately visible.
  const becameTapered = parsed.tapered === true && !current.tapered
  if (
    becameTapered &&
    parsed.topDiameterMm === undefined &&
    Math.abs(form.topDiameterMm - form.bottomDiameterMm) < SIZE_EPSILON_MM
  ) {
    form.topDiameterMm = Math.min(300, Math.round(form.bottomDiameterMm * 1.4))
  }
  // Straight forms have one width: keep top mirroring bottom.
  if (!form.tapered) {
    form.topDiameterMm = form.bottomDiameterMm
  }
  return form
}

export function applyClayPatch(current: ClaySettings, patch: SetClayInput): ClaySettings {
  return { ...current, ...setClayInputSchema.parse(patch) }
}
