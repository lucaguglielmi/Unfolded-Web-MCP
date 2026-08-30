import { z } from "zod"

/**
 * All linear dimensions are millimeters of the FIRED piece (what the potter
 * wants to end up with). Templates are scaled up for clay shrinkage at
 * unroll time — see lib/geometry/unroll.ts.
 */

export const formTypeSchema = z
  .enum(["round", "faceted"])
  .describe(
    "Base geometry of the wall. 'round' is a circular wall (a cylinder, or a cone frustum when tapered); 'faceted' is a prism with `facets` flat sides (a pyramid frustum when tapered). Taper is a separate flag — any shape can be straight or tapered."
  )

export const formParamsSchema = z.object({
  type: formTypeSchema,
  tapered: z
    .boolean()
    .describe(
      "When true, the top and bottom sizes differ (cone frustum for round, pyramid frustum for faceted) and topDiameterMm applies. When false the wall is straight and the top mirrors bottomDiameterMm."
    ),
  name: z.string().min(1).max(60).describe("Display name of the piece, e.g. 'Classic mug'"),
  heightMm: z.number().min(20).max(600).describe("Fired height of the wall in millimeters"),
  topDiameterMm: z
    .number()
    .min(20)
    .max(500)
    .describe(
      "Fired outer size at the rim in millimeters (used when tapered is true; straight forms mirror bottomDiameterMm). For 'faceted' forms this is measured across corners."
    ),
  bottomDiameterMm: z
    .number()
    .min(20)
    .max(500)
    .describe("Fired outer size at the base in millimeters. For 'faceted' forms this is measured across corners (the circumscribed circle)."),
  facets: z
    .number()
    .int()
    .min(3)
    .max(8)
    .describe("Number of flat sides for type 'faceted' (3 = triangle, 4 = square, 5 = pentagon, 6 = hexagon). Ignored for round forms."),
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
    .describe("Total wet-to-fired shrinkage of the clay body in percent (stoneware is typically 10-13)"),
  wallThicknessMm: z
    .number()
    .min(2)
    .max(15)
    .describe("Slab thickness in millimeters (typically 4-6 for mugs)"),
})

export type FormType = z.infer<typeof formTypeSchema>
export type FormParams = z.infer<typeof formParamsSchema>
export type ClaySettings = z.infer<typeof claySettingsSchema>

export const updateFormInputSchema = formParamsSchema.partial()
export const setClayInputSchema = claySettingsSchema.partial()

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
