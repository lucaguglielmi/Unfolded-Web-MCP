import { z } from "zod"

/**
 * All linear dimensions are millimeters of the FIRED piece (what the potter
 * wants to end up with). Templates are scaled up for clay shrinkage at
 * unroll time — see lib/geometry/unroll.ts.
 */

export const formTypeSchema = z
  .enum(["round", "faceted"])
  .describe(
    "'round' (a cylinder, or a cone when tapered) or 'faceted' (a prism of `facets` flat sides). Taper is the separate flag."
  )

export const formParamsSchema = z.object({
  type: formTypeSchema,
  tapered: z
    .boolean()
    .describe("True: rim and base differ and topDiameterMm applies. False: straight wall."),
  name: z.string().min(1).max(60).describe("Display name, e.g. 'Classic mug'"),
  heightMm: z.number().min(20).max(600).describe("Fired height, mm"),
  topDiameterMm: z
    .number()
    .min(20)
    .max(500)
    .describe("Fired rim size, mm (when tapered); across corners for faceted"),
  bottomDiameterMm: z
    .number()
    .min(20)
    .max(500)
    .describe("Fired base size, mm; across corners for faceted"),
  facets: z
    .number()
    .int()
    .min(3)
    .max(8)
    .describe("Sides for 'faceted': 3 triangle, 4 square, 5 pentagon, 6 hexagon, 8 octagon; ignored for round"),
})

/**
 * Accept the pre-taper-split vocabulary from old share links, persisted
 * sessions, and agents that read earlier tool docs: type 'cylinder' means
 * round+straight, type 'tapered' means round+tapered. An explicit `tapered`
 * in the same patch wins over what the legacy type implies.
 */
export function normalizeLegacyFormPatch(patch: Record<string, unknown>): Record<string, unknown> {
  const p = { ...patch }
  if (p.type === "cylinder") {
    p.type = "round"
    if (p.tapered === undefined) p.tapered = false
  } else if (p.type === "tapered") {
    p.type = "round"
    if (p.tapered === undefined) p.tapered = true
  }
  return p
}

export const claySettingsSchema = z.object({
  shrinkagePct: z
    .number()
    .min(0)
    .max(25)
    .describe("Total wet-to-fired shrinkage, percent (stoneware typically 10-13)"),
  wallThicknessMm: z
    .number()
    .min(2)
    .max(15)
    .describe("Wet slab thickness, mm, as rolled (typically 4-6 for mugs); shrinks with the clay"),
})

export type FormType = z.infer<typeof formTypeSchema>
export type FormParams = z.infer<typeof formParamsSchema>
export type ClaySettings = z.infer<typeof claySettingsSchema>

export const updateFormInputSchema = formParamsSchema.partial()
export const setClayInputSchema = claySettingsSchema.partial()

/** the pre-taper-split `type` vocabulary normalizeLegacyFormPatch still honors */
export const LEGACY_FORM_TYPES = ["cylinder", "tapered"] as const

/**
 * The update_form tool's advertised contract: the form patch with the
 * legacy `type` values admitted, so a host that validates calls against
 * the advertised schema lets them through to normalizeLegacyFormPatch —
 * what is advertised is exactly what is accepted.
 */
export const updateFormToolInputSchema = updateFormInputSchema.extend({
  type: z
    .enum([...formTypeSchema.options, ...LEGACY_FORM_TYPES])
    .optional()
    .describe(
      `${formTypeSchema.description} Legacy: 'cylinder' (round, straight), 'tapered' (round, tapered).`
    ),
})

export type UpdateFormInput = z.infer<typeof updateFormInputSchema>
export type SetClayInput = z.infer<typeof setClayInputSchema>

export const PRESETS: Record<string, FormParams> = {
  "classic-mug": {
    type: "round",
    tapered: false,
    name: "Classic mug",
    heightMm: 100,
    topDiameterMm: 85,
    bottomDiameterMm: 85,
    facets: 4,
  },
  tumbler: {
    type: "round",
    tapered: true,
    name: "Tapered tumbler",
    heightMm: 130,
    topDiameterMm: 90,
    bottomDiameterMm: 65,
    facets: 4,
  },
  "bud-vase": {
    type: "round",
    tapered: true,
    name: "Bud vase",
    heightMm: 180,
    topDiameterMm: 45,
    bottomDiameterMm: 90,
    facets: 4,
  },
  "hex-planter": {
    type: "faceted",
    tapered: false,
    name: "Hex planter",
    heightMm: 110,
    topDiameterMm: 140,
    bottomDiameterMm: 140,
    facets: 6,
  },
}

export const DEFAULT_CLAY: ClaySettings = {
  shrinkagePct: 12,
  wallThicknessMm: 5,
}
