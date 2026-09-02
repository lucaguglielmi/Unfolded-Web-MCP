import { z } from "zod"
import { capacityMl, heightForCapacityMl } from "@/lib/geometry/unroll"
import { setClayInputSchema, updateFormInputSchema, PRESETS } from "@/lib/model/schemas"
import { parseShareParams } from "@/lib/model/shareLink"
import { capturePreviewImage } from "@/lib/previewCapture"
import { liveSync } from "@/store/syncClient"
import { useProjectStore } from "@/store/useProjectStore"
import { describeState, describeTemplates } from "./describe"
import { createLiveHandoff } from "./liveHandoff"
import type { SetClayInput, UpdateFormInput } from "@/lib/model/schemas"
import { textResult, type ToolDescriptor, type ToolExecuteOptions, type ToolResult } from "./modelContext"

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
  { name: "describe_project", blurb: "Read the whole design: form, clay, template pieces, capacity in ml, and its permanent design link." },
  { name: "open_model", blurb: "Open a design from a pasted share link and keep editing it." },
  { name: "update_form", blurb: "Change shape, taper, facets, height and diameters — fired sizes, in millimeters." },
  { name: "set_clay", blurb: "Set shrinkage % and slab thickness for the potter's clay body." },
  { name: "set_units", blurb: "Switch the potter's display units between centimeters and inches — UI and PDF alike." },
  { name: "set_capacity", blurb: "Solve the height for a target interior volume — 'make it hold 350 ml'." },
  { name: "get_template_summary", blurb: "Template layout, per-piece dimensions, and the exact PDF page count." },
  { name: "get_preview_image", blurb: "See the live 3D preview as an image — exactly what the potter sees." },
  { name: "export_templates", blurb: "Generate and download the true-scale, multi-page template PDF." },
  { name: "apply_preset", blurb: "Start from a classic mug, tumbler, bud vase, or hex planter." },
  { name: "create_live_handoff", blurb: "Mint the single-use link that continues this design live on the potter's screen — the default link after any edit." },
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

/**
 * The link policy, in one sentence, on every tool that creates, edits, or
 * opens a design (docs/live-handoff-link-spec.md §8.1): the full rules
 * live on create_live_handoff itself, so this stays cheap in the discovery
 * metadata every conversation pays for.
 */
const LINK_RULE = " Any link you then give the potter must come from create_live_handoff, never the address bar."


/** z.toJSONSchema emits a "$schema" identifier the host never needs —
    dropping it saves content-free chars from every conversation's context */
function toInputSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _dropped, ...json } = z.toJSONSchema(schema) as Record<string, unknown>
  return json
}

/** the one consistent shape for a host-cancelled call (spec 4.4) */
function cancelledResult(): ToolResult {
  return textResult("Cancelled by the host before completing — no changes were made.", true)
}

/** agent-readable zod issues: path, message (zod v4 messages carry the
    bounds/options), and the received value when the issue exposes it */
function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const received =
        "input" in issue && issue.input !== undefined
          ? ` (received ${JSON.stringify(issue.input)})`
          : ""
      return `${issue.path.join(".") || "(root)"}: ${issue.message}${received}`
    })
    .join("\n")
}

function run(
  tool: string,
  options: ToolExecuteOptions | undefined,
  fn: () => ToolResult
): Promise<ToolResult> {
  if (options?.signal?.aborted) return Promise.resolve(cancelledResult())
  useProjectStore.getState().recordAgentCall(tool)
  try {
    return Promise.resolve(fn())
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Promise.resolve(
        textResult(`Invalid input:\n${formatIssues(error)}\n\nCurrent state unchanged:\n${stateText()}`, true)
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
        "Get the current pottery design: form type and dimensions (fired mm), clay settings, the flat template pieces it unrolls into (wet-clay sizes, shrinkage already applied), capacityMl, and designUrl — a permanent link that reopens an independent copy (no live session; give it out only when the potter explicitly asks for a permanent or bookmarkable link — otherwise links come from create_live_handoff). Call this first to see what the potter is working on. This page is live-synced: it changes on its own when the potter edits on another screen or a device joins or leaves, so if your browser refuses a tool call because the page changed since you last looked, just look again and retry — nothing went wrong.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      title: "Describe current design",
      annotations: { title: "Describe current design", readOnlyHint: true },
      execute: (_input, options) => run("describe_project", options, () => textResult(stateText())),
    },
    {
      name: "open_model",
      description:
        "Open a pottery design from an Unfolded share link — the full URL or just its query string, e.g. '?type=tapered&height=600&bottom=300&top=100&shrinkage=12&wall=5'. Parameters: type (cylinder, tapered, triangle, square, pentagon, hexagon, heptagon, octagon), height/bottom/top (fired mm; a 'top' value implies tapered), name, shrinkage (percent), wall (mm), paper (A4/A3/Letter). Missing parameters keep current values; out-of-range values clamp. Returns the full new state, ready for further edits." + LINK_RULE,
      inputSchema: toInputSchema(
        z.object({
          url: z.string().min(1).describe("Share link URL, or just its query string"),
        })
      ),
      title: "Open model from link",
      annotations: { title: "Open model from link" },
      execute: (input, options) =>
        run("open_model", options, () => {
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
        "Update any subset of the pottery form's fields — each property documents itself in the input schema (type round/faceted, the independent tapered flag, facets, name, and the mm dimensions). Legacy type values 'cylinder' and 'tapered' are still accepted. Dimensions are FIRED millimeters; shrinkage compensation is applied to the templates automatically, and the potter's 3D preview updates immediately. Returns the full new state including capacityMl. For a target volume like 'a 350 ml mug', prefer set_capacity — it solves the height exactly in one call." + LINK_RULE,
      inputSchema: toInputSchema(updateFormInputSchema),
      title: "Update form dimensions",
      annotations: { title: "Update form dimensions" },
      execute: (input, options) =>
        run("update_form", options, () => {
          // the store action validates with the same zod schema
          useProjectStore.getState().updateForm((input ?? {}) as UpdateFormInput)
          return textResult(stateText("Form updated."))
        }),
    },
    {
      name: "set_clay",
      description:
        "Update clay settings: shrinkagePct (total wet-to-fired shrinkage, e.g. 12 for a typical stoneware), wallThicknessMm (slab thickness). These change how the flat templates are computed (shrinkage scales them up; wall thickness shifts the developed mid-surface). Returns the full new state." + LINK_RULE,
      inputSchema: toInputSchema(setClayInputSchema),
      title: "Set clay properties",
      annotations: { title: "Set clay properties" },
      execute: (input, options) =>
        run("set_clay", options, () => {
          useProjectStore.getState().setClay((input ?? {}) as SetClayInput)
          return textResult(stateText("Clay settings updated."))
        }),
    },
    {
      name: "set_units",
      description:
        "Set the potter's preferred display units: 'cm' (default) or 'in'. Display-only — it changes every human-facing measurement (UI, warnings, and the printed PDF with its scale-check bar); tool inputs and outputs stay in millimeters regardless. Remembered in the browser and on share links. Returns the full new state." + LINK_RULE,
      inputSchema: toInputSchema(
        z.object({
          units: z.enum(["cm", "in"]).describe("Preferred display units: 'cm' or 'in'"),
        })
      ),
      title: "Set measurement units",
      annotations: { title: "Set measurement units" },
      execute: (input, options) =>
        run("set_units", options, () => {
          const { units } = z.object({ units: z.enum(["cm", "in"]) }).parse(input ?? {})
          useProjectStore.getState().setUnit(units)
          return textResult(stateText(`Measurement units set to ${units === "in" ? "inches" : "centimeters"}.`))
        }),
    },
    {
      name: "set_capacity",
      description:
        "Set the vessel's interior capacity in milliliters. Volume is linear in height, so this solves the exact height for the target — never iterate with update_form. If the height clamps at the buildable 20-600 mm range the response reports the achievable capacity; adjust the diameters and call again. Returns the full new state." + LINK_RULE,
      inputSchema: toInputSchema(
        z.object({
          capacityMl: z
            .number()
            .min(1)
            .max(200000)
            .describe("Target fired interior capacity in milliliters, e.g. 350 for a mug"),
        })
      ),
      title: "Set capacity",
      annotations: { title: "Set capacity" },
      execute: (input, options) =>
        run("set_capacity", options, () => {
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
      title: "Template summary",
      annotations: { title: "Template summary", readOnlyHint: true },
      execute: (_input, options) =>
        run("get_template_summary", options, () => textResult(JSON.stringify(describeTemplates(), null, 2))),
    },
    {
      name: "get_preview_image",
      description:
        "See what the potter sees: a compact JPEG snapshot of the live 3D preview, deliberately small so it costs little context. Use it to visually confirm a change. If the canvas can't be captured here, a text description is returned instead. Read-only.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      title: "See the 3D preview",
      annotations: { title: "See the 3D preview", readOnlyHint: true },
      execute: (_input, options) =>
        run("get_preview_image", options, () => {
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
        "Export the printable template as a multi-page PDF and download it in the potter's browser — remind them to print at 100% scale and check the calibration ruler on page 1. Pages tile the true-scale template with 10 mm glue overlaps. Optionally set paperSize ('A4', 'A3', or 'Letter') first. Returns the page count.",
      inputSchema: toInputSchema(
        z.object({
          paperSize: z.enum(["A4", "A3", "Letter"]).optional().describe("Paper size for the printout"),
        })
      ),
      title: "Export printable PDF",
      annotations: { title: "Export printable PDF" },
      execute: async (input, options) => {
        if (options?.signal?.aborted) return cancelledResult()
        useProjectStore.getState().recordAgentCall("export_templates")
        try {
          const { paperSize } = z
            .object({ paperSize: z.enum(["A4", "A3", "Letter"]).optional() })
            .parse(input ?? {})
          if (paperSize) useProjectStore.getState().setPaperSize(paperSize)
          // last safe point: past here the PDF generates and downloads
          if (options?.signal?.aborted) return cancelledResult()
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
      description: `Start from a known-good preset design. Available presets: ${Object.keys(PRESETS).join(", ")}. Overwrites the current form and clay settings (undo_last_change reverts it). Returns the full new state.` + LINK_RULE,
      inputSchema: toInputSchema(
        z.object({
          preset: z.enum(Object.keys(PRESETS) as [string, ...string[]]).describe("Preset id"),
        })
      ),
      title: "Apply a preset",
      annotations: { title: "Apply a preset" },
      execute: (input, options) =>
        run("apply_preset", options, () => {
          const { preset } = z
            .object({ preset: z.enum(Object.keys(PRESETS) as [string, ...string[]]) })
            .parse(input ?? {})
          useProjectStore.getState().applyPreset(preset as keyof typeof PRESETS)
          return textResult(stateText(`Preset '${preset}' applied.`))
        }),
    },
    {
      name: "create_live_handoff",
      description:
        "Create a fresh, single-use link that lets the potter continue this exact design in the same live session on another screen — edits then flow both ways, and their changes show in your next read. This is the DEFAULT link tool: call it immediately before returning any Unfolded link — after creating, editing, previewing, or opening a design, and for 'send me the link', 'show me', 'open it', or 'continue in the browser'. Return liveHandoffUrl verbatim: never the current page or address-bar URL, a previously returned link, or a reconstructed one. Skip it only when the potter explicitly asks for a permanent, bookmarkable, printable, or independent-copy link (that is designUrl). The invitation expires after 15 minutes and works once. On failure no link exists: retry once, then offer start_pairing.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      title: "Create live handoff link",
      annotations: { title: "Create live handoff link" },
      execute: async (_input, options) => {
        if (options?.signal?.aborted) return cancelledResult()
        useProjectStore.getState().recordAgentCall("create_live_handoff")
        try {
          const handoff = await createLiveHandoff()
          // a cancel that lands mid-mint: the unused token simply expires
          if (options?.signal?.aborted) return cancelledResult()
          if (!handoff) {
            // fail closed — no fallback URL of any kind (spec §7)
            return textResult(
              "A live handoff link could not be created because the pairing service is unavailable. " +
                "No link was generated. Retry once, or use start_pairing to create a six-character code.",
              true
            )
          }
          return textResult(JSON.stringify(handoff, null, 2))
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return textResult(`A live handoff link could not be created (${message}). No link was generated. Retry once, or use start_pairing.`, true)
        }
      },
    },
    {
      name: "join_session",
      description:
        "Pair this tab into a live cross-device session using the 6-character code from the potter's OTHER device, e.g. 'K7F-3QP'. This tab adopts that session's design (one undo step brings the previous one back); afterwards every edit on any device syncs live within about a second. Codes expire in 15 minutes and work once — on failure ask for a fresh one. Returns the full state after joining.",
      inputSchema: toInputSchema(
        z.object({
          code: z
            .string()
            .min(1)
            .describe("6-character code from the potter's other device, e.g. 'K7F-3QP' (case/dashes ignored)"),
        })
      ),
      title: "Join live session",
      annotations: { title: "Join live session" },
      execute: async (input, options) => {
        if (options?.signal?.aborted) return cancelledResult()
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
          // the signal reaches the claim fetch; a cancel aborts the network
          // call and joinWithCode commits nothing afterwards
          const joined = await liveSync.joinWithCode(code, options?.signal)
          if (!joined.ok) {
            return textResult(
              joined.retryable
                ? "The pairing service is busy — wait a minute and try once more."
                : "That code didn't work — codes expire after 15 minutes and can be used once. " +
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
        "Mint a 6-character pairing code for THIS tab's live session and tell it to the potter. Entered on their other device (connection button → Continue on another screen), that device then FOLLOWS this design — use this when the work lives here and the potter wants it on another screen, e.g. 'put this on my desktop'. Valid 15 minutes, one use; both devices stay live peers afterwards. Returns the full state.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      title: "Start device pairing",
      annotations: { title: "Start device pairing" },
      execute: async (_input, options) => {
        if (options?.signal?.aborted) return cancelledResult()
        useProjectStore.getState().recordAgentCall("start_pairing")
        try {
          const minted = await liveSync.mintCode()
          // a cancel that lands mid-mint: the unused code simply expires
          // and the never-peered session forgets itself (solo grace)
          if (options?.signal?.aborted) return cancelledResult()
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
              `Pairing code: ${prettyCode(minted.code)} — valid 15 minutes, one use. ` +
                "On the other device: the connection button (two dots in the header) → Continue on another screen → enter this code. " +
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
        "Undo the most recent change to the design (form, clay, or paper size) — whether it was made by you or by the potter in the UI. Rapid consecutive changes (like a slider drag, or opening a link) count as one step; up to 50 steps are kept. Returns the full state after undoing." + LINK_RULE,
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      title: "Undo last change",
      annotations: { title: "Undo last change" },
      execute: (_input, options) =>
        run("undo_last_change", options, () => {
          if (!useProjectStore.getState().undo()) {
            return textResult(`Nothing to undo.\n\nCurrent state:\n${stateText()}`, true)
          }
          return textResult(stateText("Undid the last change."))
        }),
    },
  ]
}
