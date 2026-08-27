import { z } from "zod"

/**
 * All linear dimensions are millimeters of the FIRED piece (what the potter
 * wants to end up with). Templates are scaled up for clay shrinkage at
 * unroll time — see lib/geometry/unroll.ts.
 */

export const formTypeSchema = z
  .enum(["cylinder", "tapered"])
  .describe("Form construction type. 'cylinder' is a straight-walled form; 'tapered' is a cone frustum with different top and bottom diameters.")

export const formParamsSchema = z.object({
  type: formTypeSchema,
  name: z.string().min(1).max(60).describe("Display name of the piece, e.g. 'Classic mug'"),
  heightMm: z.number().min(20).max(600).describe("Fired height of the wall in millimeters"),
  topDiameterMm: z
    .number()
    .min(20)
    .max(500)
    .describe("Fired outer diameter at the rim in millimeters (ignored for type 'cylinder', which uses bottomDiameterMm)"),
  bottomDiameterMm: z
    .number()
    .min(20)
    .max(500)
    .describe("Fired outer diameter at the base in millimeters"),
})

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
    type: "cylinder",
    name: "Classic mug",
    heightMm: 100,
    topDiameterMm: 85,
    bottomDiameterMm: 85,
  },
  tumbler: {
    type: "tapered",
    name: "Tapered tumbler",
    heightMm: 130,
    topDiameterMm: 90,
    bottomDiameterMm: 65,
  },
  "bud-vase": {
    type: "tapered",
    name: "Bud vase",
    heightMm: 180,
    topDiameterMm: 45,
    bottomDiameterMm: 90,
  },
}

export const DEFAULT_CLAY: ClaySettings = {
  shrinkagePct: 12,
  wallThicknessMm: 5,
}
