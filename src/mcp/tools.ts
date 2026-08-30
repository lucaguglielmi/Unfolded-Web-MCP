import { z } from "zod"
import { setClayInputSchema, updateFormInputSchema, PRESETS } from "@/lib/model/schemas"
import { parseShareParams } from "@/lib/model/shareLink"
import { capturePreviewPng } from "@/lib/previewCapture"
import { describeState, describeTemplates, useProjectStore } from "@/store/useProjectStore"
import type { SetClayInput, UpdateFormInput } from "@/lib/model/schemas"
import { textResult, type ToolDescriptor, type ToolResult } from "./modelContext"

/**
 * The WebMCP tool surface. Design rules:
 *  - few tools, rich descriptions, structured JSON results
 *  - every mutating tool returns the full new state so the agent never needs
 *    a follow-up read to know what happened
 *  - all mutations go through the same store actions the UI uses
 */

function stateText(prefix?: string): string {
  const state = describeState()
  return (prefix ? `${prefix}\n` : "") + JSON.stringify(state, null, 2)
}

function run(tool: string, fn: () => ToolResult): Promise<ToolResult> {
  useProjectStore.getState().recordAgentCall(tool)
  try {
    return Promise.resolve(fn())
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      return Promise.resolve(
        textResult(`Invalid input:\n${issues.join("\n")}\n\nCurrent state unchanged:\n${stateText()}`, true)
      )
    }
    const message = error instanceof Error ? error.message : String(error)
    return Promise.resolve(textResult(`Tool failed: ${message}`, true))
  }
}

export function buildTools(): ToolDescriptor[] {
  return [
    {
      name: "describe_project",
      description:
        "Get the current pottery design: form type and dimensions (fired sizes, in mm), clay settings (shrinkage, wall thickness), the flat template pieces the design unrolls into (wet-clay sizes, already scaled up for shrinkage), capacityMl (approximate fired interior volume), and shareUrl — a deep link that reopens exactly this design. Call this first to see what the potter is working on.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, title: "Describe current design" },
      execute: () => run("describe_project", () => textResult(stateText())),
    },
    {
      name: "open_model",
      description:
        "Open a pottery design from an Unfolded share link. Pass the full URL (any domain — the deployment host may change) or just its query string, e.g. '?type=tapered&height=600&bottom=300&top=100&shrinkage=12&wall=5'. Recognized parameters: type (cylinder, tapered, triangle, square, pentagon, hexagon, heptagon, octagon), height / bottom / top (fired mm; a 'top' value marks the form as tapered — works for faceted shapes too, e.g. 'type=hexagon&top=120'), name, shrinkage (percent), wall (mm), paper (A4 or Letter). Parameters missing from the link keep their current values; out-of-range values are clamped. The same link opens the design directly in a browser, and every state snapshot includes shareUrl — give that to the potter to save or share the current design. Returns the full new state, ready for further update_form / set_clay edits.",
      inputSchema: z.toJSONSchema(
        z.object({
          url: z.string().min(1).describe("Share link URL, or just its query string"),
        })
      ),
      annotations: { title: "Open model from link", idempotentHint: true },
      execute: (input) =>
        run("open_model", () => {
          const { url } = z.object({ url: z.string().min(1) }).parse(input ?? {})
          const patches = parseShareParams(url)
          if (!patches.form && !patches.clay && !patches.paperSize) {
            return textResult(
              "No recognizable design parameters in that link. Expected query parameters " +
                "like type, height, bottom, top, name, shrinkage, wall, paper.\n\n" +
                `Current state unchanged:\n${stateText()}`,
              true
            )
          }
          useProjectStore.getState().openModel(patches)
          return textResult(stateText("Model opened from link."))
        }),
    },
    {
      name: "update_form",
      description:
        "Update the pottery form. Any subset of: type ('round' = circular wall, 'faceted' = prism with flat sides), tapered (boolean — its own axis, so ANY shape can taper: true makes the top differ from the bottom, a cone frustum for round or a pyramid frustum for faceted, and topDiameterMm applies; false keeps the wall straight with top mirroring bottom), facets (side count for faceted forms: 3 = triangle, 4 = square, 5 = pentagon, 6 = hexagon), name, heightMm, topDiameterMm, bottomDiameterMm (for faceted forms widths are across corners). Legacy type values 'cylinder' and 'tapered' are still accepted. Dimensions are FIRED sizes in millimeters — shrinkage compensation is applied automatically to the templates. The 3D preview and the flat templates the potter sees update immediately. Returns the full new state, including capacityMl (approximate fired interior volume) — for a target like 'a 350 ml mug', adjust dimensions and check capacityMl until it matches.",
      inputSchema: z.toJSONSchema(updateFormInputSchema),
      annotations: { title: "Update form dimensions", idempotentHint: true },
      execute: (input) =>
        run("update_form", () => {
          // the store action validates with the same zod schema
          useProjectStore.getState().updateForm((input ?? {}) as UpdateFormInput)
          return textResult(stateText("Form updated."))
        }),
    },
    {
      name: "set_clay",
      description:
        "Update clay settings: shrinkagePct (total wet-to-fired shrinkage, e.g. 12 for a typical stoneware), wallThicknessMm (slab thickness). These change how the flat templates are computed (shrinkage scales them up; wall thickness shifts the developed mid-surface). Returns the full new state.",
      inputSchema: z.toJSONSchema(setClayInputSchema),
      annotations: { title: "Set clay properties", idempotentHint: true },
      execute: (input) =>
        run("set_clay", () => {
          useProjectStore.getState().setClay((input ?? {}) as SetClayInput)
          return textResult(stateText("Clay settings updated."))
        }),
    },
    {
      name: "get_template_summary",
      description:
        "Get the printable template details: each flat piece with wet-clay dimensions and assembly notes, the overall layout size, glue overlap, and exactly how many pages the PDF will have at the current paper size (A4 or Letter). Read-only.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, title: "Template summary" },
      execute: () =>
        run("get_template_summary", () => textResult(JSON.stringify(describeTemplates(), null, 2))),
    },
    {
      name: "get_preview_image",
      description:
        "See what the potter sees: a PNG snapshot of the live 3D preview — the hollow clay render with its dimension callouts. Use it to visually confirm a change or to describe the current form. If the canvas can't be captured in this environment, a text description of the design is returned instead. Read-only.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, title: "See the 3D preview" },
      execute: () =>
        run("get_preview_image", () => {
          const state = describeState()
          const summary =
            `3D preview of "${state.form.name}": ${state.form.tapered ? "tapered " : ""}${state.form.type}` +
            (state.form.type === "faceted" ? ` (${state.form.facets} sides)` : "") +
            `, ${state.form.heightMm} mm tall x ${state.form.bottomDiameterMm} mm wide (fired), ` +
            `holds ~${state.capacityMl} ml.`
          const png = capturePreviewPng()
          if (!png) {
            return textResult(
              `Preview image unavailable (the 3D canvas hasn't rendered in this environment). ${summary}`
            )
          }
          return {
            content: [
              { type: "image", data: png, mimeType: "image/png" },
              { type: "text", text: summary },
            ],
          }
        }),
    },
    {
      name: "export_templates",
      description:
        "Export the printable template as a multi-page PDF and download it in the potter's browser. Pages tile the true-scale template with 10 mm glue overlaps; page 1 has assembly instructions, an assembly map, and a calibration ruler. Optionally set paperSize ('A4' or 'Letter') first. Returns the page count.",
      inputSchema: z.toJSONSchema(
        z.object({
          paperSize: z.enum(["A4", "Letter"]).optional().describe("Paper size for the printout"),
        })
      ),
      annotations: { title: "Export printable PDF" },
      execute: async (input) => {
        useProjectStore.getState().recordAgentCall("export_templates")
        try {
          const { paperSize } = z
            .object({ paperSize: z.enum(["A4", "Letter"]).optional() })
            .parse(input ?? {})
          if (paperSize) useProjectStore.getState().setPaperSize(paperSize)
          const result = await useProjectStore.getState().exportPdf()
          return textResult(
            `PDF downloaded in the potter's browser: ${result.pages} pages on ${result.paper} ` +
              `(1 overview + ${result.pages - 1} template pages in a ${result.rows}x${result.cols} grid). ` +
              `Remind the potter to print at 100% scale and verify the calibration ruler.`
          )
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return textResult(`Export failed: ${message}`, true)
        }
      },
    },
    {
      name: "apply_preset",
      description: `Start from a known-good preset design. Available presets: ${Object.keys(PRESETS).join(", ")}. Overwrites the current form and clay settings (undo_last_change reverts it). Returns the full new state.`,
      inputSchema: z.toJSONSchema(
        z.object({
          preset: z.enum(Object.keys(PRESETS) as [string, ...string[]]).describe("Preset id"),
        })
      ),
      annotations: { title: "Apply a preset", destructiveHint: true },
      execute: (input) =>
        run("apply_preset", () => {
          const { preset } = z
            .object({ preset: z.enum(Object.keys(PRESETS) as [string, ...string[]]) })
            .parse(input ?? {})
          useProjectStore.getState().applyPreset(preset as keyof typeof PRESETS)
          return textResult(stateText(`Preset '${preset}' applied.`))
        }),
    },
    {
      name: "undo_last_change",
      description:
        "Undo the most recent change to the design (form, clay, or paper size) — whether it was made by you or by the potter in the UI. Rapid consecutive changes (like a slider drag, or opening a link) count as one step; up to 50 steps are kept. Returns the full state after undoing.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { title: "Undo last change" },
      execute: () =>
        run("undo_last_change", () => {
          if (!useProjectStore.getState().undo()) {
            return textResult(`Nothing to undo.\n\nCurrent state:\n${stateText()}`, true)
          }
          return textResult(stateText("Undid the last change."))
        }),
    },
  ]
}
