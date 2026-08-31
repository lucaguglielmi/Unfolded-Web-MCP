import { z } from "zod"
import { capacityMl, heightForCapacityMl } from "@/lib/geometry/unroll"
import { setClayInputSchema, updateFormInputSchema, PRESETS } from "@/lib/model/schemas"
import { parseShareParams } from "@/lib/model/shareLink"
import { capturePreviewImage } from "@/lib/previewCapture"
import { liveSync } from "@/store/syncClient"
import { useProjectStore } from "@/store/useProjectStore"
import { describeState, describeTemplates } from "./describe"
import type { SetClayInput, UpdateFormInput } from "@/lib/model/schemas"
import { textResult, type ToolDescriptor, type ToolResult } from "./modelContext"

/**
 * The WebMCP tool surface. Design rules:
 *  - few tools, rich descriptions, structured JSON results
 *  - every mutating tool returns the full new state so the agent never needs
 *    a follow-up read to know what happened
 *  - all mutations go through the same store actions the UI uses
 */

/**
 * One-line human summaries of the tool surface, in registration order —
 * the single source the /webmcp page renders (and counts). A unit test
 * asserts this list matches buildTools() name-for-name, so adding a tool
 * without its summary fails the build. The e2e suite's EXPECTED_TOOLS is
 * deliberately NOT derived from here: it is the independent contract check.
 */
export const TOOL_SUMMARIES: { name: string; blurb: string }[] = [
  { name: "describe_project", blurb: "Read the whole design: form, clay, template pieces, capacity in ml, and its share link." },
  { name: "open_model", blurb: "Open a design from a pasted share link and keep editing it." },
  { name: "update_form", blurb: "Change shape, taper, facets, height and diameters — fired sizes, in millimeters." },
  { name: "set_clay", blurb: "Set shrinkage % and slab thickness for the potter's clay body." },
  { name: "set_units", blurb: "Switch the potter's display units between centimeters and inches — UI and PDF alike." },
  { name: "set_capacity", blurb: "Solve the height for a target interior volume — 'make it hold 350 ml'." },
  { name: "get_template_summary", blurb: "Template layout, per-piece dimensions, and the exact PDF page count." },
  { name: "get_preview_image", blurb: "See the live 3D preview as an image — exactly what the potter sees." },
  { name: "export_templates", blurb: "Generate and download the true-scale, multi-page template PDF." },
  { name: "apply_preset", blurb: "Start from a classic mug, tumbler, bud vase, or hex planter." },
  { name: "join_session", blurb: "Pair this tab into a live session with the 6-character code from the potter's other device." },
  { name: "start_pairing", blurb: "Mint a 6-character code so the potter's other device can join THIS design live." },
  { name: "undo_last_change", blurb: "Revert the last change — the agent's or the potter's." },
]

/** normalized pairing-code shape — uppercase, separators stripped, 6 glyphs
    from the unambiguous alphabet (no I, L, O, 0, 1) */
const PAIR_CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/
const prettyCode = (code: string) => `${code.slice(0, 3)}-${code.slice(3)}`

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
        "Get the current pottery design: form type and dimensions (fired sizes, in mm), clay settings (shrinkage, wall thickness), the flat template pieces the design unrolls into (wet-clay sizes, already scaled up for shrinkage), capacityMl (approximate fired interior volume), and shareUrl — a deep link that reopens exactly this design. shareUrl is tagged as coming from your session: when the potter opens it in another tab, the app there shows 'Connected via ChatGPT' so they know this design lives with you. Call this first to see what the potter is working on.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, title: "Describe current design" },
      execute: () => run("describe_project", () => textResult(stateText())),
    },
    {
      name: "open_model",
      description:
        "Open a pottery design from an Unfolded share link. Pass the full URL (any domain — the deployment host may change) or just its query string, e.g. '?type=tapered&height=600&bottom=300&top=100&shrinkage=12&wall=5'. Recognized parameters: type (cylinder, tapered, triangle, square, pentagon, hexagon, heptagon, octagon), height / bottom / top (fired mm; a 'top' value marks the form as tapered — works for faceted shapes too, e.g. 'type=hexagon&top=120'), name, shrinkage (percent), wall (mm), paper (A4, A3, or Letter). Parameters missing from the link keep their current values; out-of-range values are clamped. The same link opens the design directly in a browser, and every state snapshot includes shareUrl — give that to the potter to save or share the current design. Returns the full new state, ready for further update_form / set_clay edits.",
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
        "Update the pottery form. Any subset of: type ('round' = circular wall, 'faceted' = prism with flat sides), tapered (boolean — its own axis, so ANY shape can taper: true makes the top differ from the bottom, a cone frustum for round or a pyramid frustum for faceted, and topDiameterMm applies; false keeps the wall straight with top mirroring bottom), facets (side count for faceted forms: 3 = triangle, 4 = square, 5 = pentagon, 6 = hexagon), name, heightMm, topDiameterMm, bottomDiameterMm (for faceted forms widths are across corners). Legacy type values 'cylinder' and 'tapered' are still accepted. Dimensions are FIRED sizes in millimeters — shrinkage compensation is applied automatically to the templates. The 3D preview and the flat templates the potter sees update immediately. Returns the full new state, including capacityMl (approximate fired interior volume). For a target volume like 'a 350 ml mug', prefer set_capacity — it solves the height exactly in one call.",
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
      name: "set_units",
      description:
        "Set the potter's preferred measurement units: 'cm' (default) or 'in'. This is a display preference — it changes every human-facing measurement (sliders, 3D callouts, template annotations, warnings, the capacity readout, and the printed PDF, including its scale-check bar: 3 cm vs 1 in). Tool inputs and outputs stay in millimeters regardless. The choice is remembered in the potter's browser and rides on share links (?units=in). Returns the full new state.",
      inputSchema: z.toJSONSchema(
        z.object({
          units: z.enum(["cm", "in"]).describe("Preferred display units: 'cm' or 'in'"),
        })
      ),
      annotations: { title: "Set measurement units", idempotentHint: true },
      execute: (input) =>
        run("set_units", () => {
          const { units } = z.object({ units: z.enum(["cm", "in"]) }).parse(input ?? {})
          useProjectStore.getState().setUnit(units)
          return textResult(stateText(`Measurement units set to ${units === "in" ? "inches" : "centimeters"}.`))
        }),
    },
    {
      name: "set_capacity",
      description:
        "Set the vessel's interior capacity directly, in milliliters. Interior volume is linear in height, so this solves for the exact height that yields the target while keeping the shape, diameters, taper, and clay unchanged. If the needed height falls outside the buildable 20-600 mm range it is clamped and the response reports the actually achievable capacity — widen or narrow the form with update_form and call again to get closer. Returns the full new state.",
      inputSchema: z.toJSONSchema(
        z.object({
          capacityMl: z
            .number()
            .min(1)
            .max(200000)
            .describe("Target fired interior capacity in milliliters, e.g. 350 for a mug"),
        })
      ),
      annotations: { title: "Set capacity", idempotentHint: true },
      execute: (input) =>
        run("set_capacity", () => {
          const { capacityMl: target } = z
            .object({ capacityMl: z.number().min(1).max(200000) })
            .parse(input ?? {})
          const { form, clay } = useProjectStore.getState()
          const solved = heightForCapacityMl(form, clay, target)
          if (solved === null) {
            return textResult(
              "The walls close this form's interior entirely — no height can hold anything. " +
                "Thin the walls (set_clay) or widen the form (update_form) first.\n\n" +
                `Current state:\n${stateText()}`,
              true
            )
          }
          const clamped = Math.round(Math.min(600, Math.max(20, solved)) * 10) / 10
          useProjectStore.getState().updateForm({ heightMm: clamped })
          const achieved = capacityMl(useProjectStore.getState().form, clay)
          const note =
            Math.abs(clamped - solved) > 0.05
              ? `Target ${target} ml needs a ${solved.toFixed(0)} mm height — clamped to ${clamped} mm, which holds ~${achieved} ml. Adjust the diameters to get closer.`
              : `Height set to ${clamped} mm — the vessel now holds ~${achieved} ml.`
          return textResult(stateText(note))
        }),
    },
    {
      name: "get_template_summary",
      description:
        "Get the printable template details: each flat piece with wet-clay dimensions and assembly notes, the overall layout size, glue overlap, and exactly how many pages the PDF will have at the current paper size (A4, A3, or Letter). Read-only.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, title: "Template summary" },
      execute: () =>
        run("get_template_summary", () => textResult(JSON.stringify(describeTemplates(), null, 2))),
    },
    {
      name: "get_preview_image",
      description:
        "See what the potter sees: a compact JPEG snapshot (320 px) of the live 3D preview — the hollow clay render with its dimension callouts, deliberately small so it costs little context. Use it to visually confirm a change or to describe the current form. If the canvas can't be captured in this environment, a text description of the design is returned instead. Read-only.",
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
          const image = capturePreviewImage()
          if (!image) {
            return textResult(
              `Preview image unavailable (the 3D canvas hasn't rendered in this environment). ${summary}`
            )
          }
          return {
            content: [
              { type: "image", data: image.data, mimeType: image.mimeType },
              { type: "text", text: summary },
            ],
          }
        }),
    },
    {
      name: "export_templates",
      description:
        "Export the printable template as a multi-page PDF and download it in the potter's browser. Pages tile the true-scale template with 10 mm glue overlaps; page 1 has assembly instructions, an assembly map, and a calibration ruler. Optionally set paperSize ('A4', 'A3', or 'Letter') first. Returns the page count.",
      inputSchema: z.toJSONSchema(
        z.object({
          paperSize: z.enum(["A4", "A3", "Letter"]).optional().describe("Paper size for the printout"),
        })
      ),
      annotations: { title: "Export printable PDF" },
      execute: async (input) => {
        useProjectStore.getState().recordAgentCall("export_templates")
        try {
          const { paperSize } = z
            .object({ paperSize: z.enum(["A4", "A3", "Letter"]).optional() })
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
      name: "join_session",
      description:
        "Pair this tab into a live cross-device session. The potter reads you a 6-character code shown on their OTHER device (its 'Pair a device' dialog), e.g. 'K7F-3QP'; pass it here and this tab joins that session, adopting its current design (one undo step brings the previous design back). From then on every edit — yours or the potter's, on either device — syncs live to all paired devices within about a second. Codes expire after 5 minutes and work exactly once; on failure, ask the potter to mint a fresh one. Returns the full state after joining.",
      inputSchema: z.toJSONSchema(
        z.object({
          code: z
            .string()
            .min(1)
            .describe("The 6-character pairing code from the potter's other device, e.g. 'K7F-3QP' (case and dashes don't matter)"),
        })
      ),
      annotations: { title: "Join live session" },
      execute: async (input) => {
        useProjectStore.getState().recordAgentCall("join_session")
        try {
          const { code: raw } = z.object({ code: z.string().min(1) }).parse(input ?? {})
          const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, "")
          if (!PAIR_CODE_RE.test(code)) {
            return textResult(
              "That doesn't look like a pairing code — expected 6 characters like 'K7F-3QP' " +
                "(codes never contain I, L, O, 0 or 1).\n\n" +
                `Current state unchanged:\n${stateText()}`,
              true
            )
          }
          const joined = await liveSync.joinWithCode(code)
          if (!joined.ok) {
            return textResult(
              joined.retryable
                ? "The pairing service is busy — wait a minute and try once more."
                : "That code didn't work — codes expire after 5 minutes and can be used once. " +
                    "Ask the potter to mint a fresh one.\n\n" +
                    `Current state unchanged:\n${stateText()}`,
              true
            )
          }
          // the session's design arrives with the welcome — wait for it so
          // the returned state is the adopted one
          await liveSync.whenSyncing(8_000)
          const others = Math.max(0, liveSync.peers() - 1)
          return textResult(
            stateText(`Joined live session — now syncing with ${others} other device(s).`)
          )
        } catch (error) {
          if (error instanceof z.ZodError) {
            return textResult(`Invalid input: code is required.\n\nCurrent state unchanged:\n${stateText()}`, true)
          }
          const message = error instanceof Error ? error.message : String(error)
          return textResult(`Joining failed: ${message}`, true)
        }
      },
    },
    {
      name: "start_pairing",
      description:
        "Mint a 6-character pairing code for THIS tab's live session (creating the session if none exists yet) and give it to the potter. On their other device they open the 'Pair a device' dialog and enter the code; that device then FOLLOWS this design — so use this when the work lives here and the potter wants it on another screen, e.g. 'put this on my desktop'. The code is valid for 5 minutes and works exactly once; both devices stay live peers afterwards. Tell the potter the code exactly as returned.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { title: "Start device pairing" },
      execute: async () => {
        useProjectStore.getState().recordAgentCall("start_pairing")
        try {
          const minted = await liveSync.mintCode()
          if (!minted) {
            return textResult(
              "Couldn't reach the pairing service — it may not be available in this environment. " +
                "The design is unaffected; try again in a moment.\n\n" +
                `Current state:\n${stateText()}`,
              true
            )
          }
          return textResult(
            stateText(
              `Pairing code: ${prettyCode(minted.code)} — valid 5 minutes, one use. ` +
                "On the other device: the 'Pair a device' dialog (two-screens icon in the header) → enter this code. " +
                "That device will adopt this design; afterwards edits sync both ways."
            )
          )
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return textResult(`Pairing failed: ${message}`, true)
        }
      },
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
