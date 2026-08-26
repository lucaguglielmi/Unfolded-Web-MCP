import { z } from "zod"
import { setClayInputSchema, updateFormInputSchema, PRESETS } from "@/lib/model/schemas"
import { describeState, useProjectStore } from "@/store/useProjectStore"
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
        "Get the current pottery design: form type and dimensions (fired sizes, in mm), clay settings (shrinkage, wall thickness), and the flat template pieces the design unrolls into (wet-clay sizes, already scaled up for shrinkage). Call this first to see what the potter is working on.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, title: "Describe current design" },
      execute: () => run("describe_project", () => textResult(stateText())),
    },
    {
      name: "update_form",
      description:
        "Update the pottery form. Any subset of: type ('cylinder' = straight wall, 'tapered' = cone frustum), name, heightMm, topDiameterMm, bottomDiameterMm. Dimensions are FIRED sizes in millimeters — shrinkage compensation is applied automatically to the templates. The 3D preview and the flat templates the potter sees update immediately. Returns the full new state.",
      inputSchema: z.toJSONSchema(updateFormInputSchema),
      annotations: { title: "Update form dimensions" },
      execute: (input) =>
        run("update_form", () => {
          useProjectStore.getState().updateForm(updateFormInputSchema.parse(input ?? {}))
          return textResult(stateText("Form updated."))
        }),
    },
    {
      name: "set_clay",
      description:
        "Update clay settings: shrinkagePct (total wet-to-fired shrinkage, e.g. 12 for a typical stoneware), wallThicknessMm (slab thickness), seamAllowanceMm. These change how the flat templates are computed (shrinkage scales them up; wall thickness shifts the developed mid-surface). Returns the full new state.",
      inputSchema: z.toJSONSchema(setClayInputSchema),
      annotations: { title: "Set clay properties" },
      execute: (input) =>
        run("set_clay", () => {
          useProjectStore.getState().setClay(setClayInputSchema.parse(input ?? {}))
          return textResult(stateText("Clay settings updated."))
        }),
    },
    {
      name: "apply_preset",
      description: `Start from a known-good preset design. Available presets: ${Object.keys(PRESETS).join(", ")}. Overwrites the current form and clay settings. Returns the full new state.`,
      inputSchema: z.toJSONSchema(
        z.object({
          preset: z.enum(Object.keys(PRESETS) as [string, ...string[]]).describe("Preset id"),
        })
      ),
      annotations: { title: "Apply a preset" },
      execute: (input) =>
        run("apply_preset", () => {
          const { preset } = z
            .object({ preset: z.enum(Object.keys(PRESETS) as [string, ...string[]]) })
            .parse(input ?? {})
          useProjectStore.getState().applyPreset(preset as keyof typeof PRESETS)
          return textResult(stateText(`Preset '${preset}' applied.`))
        }),
    },
  ]
}
