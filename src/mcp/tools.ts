import { z } from "zod"
import { profilerTool } from "@/profiler/tool"
import { capacityMl, heightForCapacityMl } from "@/lib/geometry/unroll"
import { applyClayPatch, applyFormPatch } from "@/lib/model/applyPatch"
import { updateDesignInputSchema, PRESETS } from "@/lib/model/schemas"
import { parseShareParams } from "@/lib/model/shareLink"
import { capturePreviewImage } from "@/lib/previewCapture"
import { liveSync } from "@/store/syncClient"
import { useProjectStore } from "@/store/useProjectStore"
import { describeState, describeTemplates } from "./describe"
import { createLiveHandoff } from "./liveHandoff"
import type { SetClayInput, UpdateFormInput } from "@/lib/model/schemas"
import {
  textResult,
  type StructuredResult,
  type ToolDescriptor,
  type ToolExecuteOptions,
  type ToolResult,
} from "./modelContext"

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
export const TOOL_SUMMARIES: { name: string; blurb: string; conditional?: true }[] = [
  { name: "describe_project", blurb: "Read the whole design: form, clay, template pieces, capacity in ml, and its permanent design link." },
  { name: "open_model", blurb: "Open a design from a pasted share link and keep editing it." },
  { name: "update_design", blurb: "Change any part of the design in one call — shape, fired sizes, clay, paper, display units, or a target capacity the height is solved for." },
  { name: "get_template_summary", blurb: "Template layout, per-piece dimensions, and the exact PDF page count." },
  { name: "get_preview_image", blurb: "See the live 3D preview as an image — exactly what the potter sees." },
  { name: "export_templates", blurb: "Generate and download the true-scale, multi-page template PDF." },
  { name: "apply_preset", blurb: "Start from a classic mug, tumbler, bud vase, or hex planter." },
  { name: "create_live_handoff", blurb: "Mint the single-use link that continues this design live on the potter's screen — the default link after any edit." },
  { name: "join_session", blurb: "Pair this tab into a live session with the 6-character code from the potter's other device." },
  { name: "start_pairing", blurb: "Mint a 6-character code (and a tappable link) so the potter's other device can join THIS design live." },
  { name: "undo_last_change", blurb: "Revert the last change — the agent's or the potter's." },
  {
    name: "get_perf_report",
    blurb: "Read the built-in profiler's numbers for this tool surface — only registered when a ?perf=1 link armed it.",
    conditional: true,
  },
]

/** normalized pairing-code shape — uppercase, separators stripped, 6 glyphs
    from the unambiguous alphabet (no I, L, O, 0, 1) */
const PAIR_CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/
const prettyCode = (code: string) => `${code.slice(0, 3)}-${code.slice(3)}`

type StateSnapshot = ReturnType<typeof describeState>

/** text half of a state result: "<message>\n<compact json>", or the bare
    json. Compact on purpose (docs/webmcp-tool-performance-spec.md §5): a
    model reads it as well as pretty-printed, and every byte here is paid
    on every call */
function stateText(prefix?: string, state: StateSnapshot = describeState()): string {
  return (prefix ? `${prefix}\n` : "") + JSON.stringify(state)
}

/**
 * Structured results (contract tool-result/2) ride
 * beside the unchanged text content: `ok` mirrors !isError, `message` is
 * the sentence the text opens with, `state` is the same snapshot the text
 * serializes, and `warnings` appears only when the design has any.
 */
function structured(
  ok: boolean,
  message: string,
  state?: StateSnapshot,
  extra?: Record<string, unknown>
): StructuredResult {
  const out: StructuredResult = { ok, message, ...extra }
  if (state) {
    out.state = state
    if (state.warnings.length > 0) out.warnings = state.warnings
  }
  return out
}

/** the design snapshot for a structured failure — never lets reading it
    turn one failure into another */
function safeState(): StateSnapshot | undefined {
  try {
    return describeState()
  } catch {
    return undefined
  }
}

/** a successful read or mutation — text is "<message>\n<json>", or the
    bare json when `prefixText` is false (describe_project always was) */
function stateResult(message: string, prefixText = true): ToolResult {
  const state = describeState()
  return textResult(
    stateText(prefixText ? message : undefined, state),
    false,
    structured(true, message, state)
  )
}

/** a failure that still reports the design — text is
    "<message>\n\n<label>:\n<json>", the structured half carries the same state */
function stateError(message: string, label: "Current state unchanged" | "Current state"): ToolResult {
  const state = describeState()
  return textResult(
    `${message}\n\n${label}:\n${stateText(undefined, state)}`,
    true,
    structured(false, message, state)
  )
}

/** a failure whose text carries no state; the structured half still does
    when the design can be read */
function plainError(message: string): ToolResult {
  return textResult(message, true, structured(false, message, safeState()))
}

/** a failure that must carry NO link at all, not even the permanent one
    inside a state snapshot — the fail-closed handoff contract
    (docs/live-handoff-link-spec.md §5): a substitute URL is the incident */
function linklessError(message: string): ToolResult {
  return textResult(message, true, { ok: false, message })
}

/**
 * The link policy, in one sentence, on every tool that creates, edits, or
 * opens a design (docs/live-handoff-link-spec.md §3): the full rules
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

/**
 * Each tool's input contract, declared ONCE: the same zod object is
 * advertised to the host (as JSON Schema) and enforced on the call, so
 * the bounds an agent reads and the bounds it hits can never drift apart.
 * update_design's lives with the model (updateDesignInputSchema).
 */
const PRESET_IDS = Object.keys(PRESETS) as [string, ...string[]]
const openModelInput = z.object({
  url: z.string().min(1).describe("Share link URL, or just its query string"),
})
const exportTemplatesInput = z.object({
  paperSize: z.enum(["A4", "A3", "Letter"]).optional(),
})
const applyPresetInput = z.object({ preset: z.enum(PRESET_IDS) })
const joinSessionInput = z.object({
  code: z
    .string()
    .min(1)
    .describe("Code from the potter's other device (case and dashes ignored)"),
})

/** the one consistent shape for a host-cancelled call */
function cancelledResult(): ToolResult {
  const message = "Cancelled by the host before completing — no changes were made."
  return textResult(message, true, { ok: false, message })
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
      return Promise.resolve(stateError(`Invalid input:\n${formatIssues(error)}`, "Current state unchanged"))
    }
    const message = error instanceof Error ? error.message : String(error)
    return Promise.resolve(plainError(`Tool failed: ${message}`))
  }
}

export function buildTools(): ToolDescriptor[] {
  const tools: ToolDescriptor[] = [
    {
      name: "describe_project",
      description:
        "Get the current design: form (fired mm), clay, the flat template pieces it unrolls into (wet-clay sizes, shrinkage applied), capacityMl, designUrl — a permanent link to an independent copy, given out only when the potter explicitly asks for a permanent or bookmarkable link (otherwise links come from create_live_handoff) — and session (whether this tab is paired, and with how many devices). Read it when the request depends on what is there now — 'what am I designing?', 'make it taller', 'will this print on one page?' — or when the potter has just connected; an absolute edit ('make it 12 cm tall') can go straight to update_design, which returns this same snapshot. When session.paired is false, offer the potter both ways in, in this order: (1) call create_live_handoff and give them its liveHandoffUrl as a link labelled 'Open a paired browser session with this chat' — one tap opens this design on their screen, paired with this conversation; (2) or, if they already have the design open on another device, ask for its six-character code — it's in the connection button, top right (two dots) → Continue on another screen, tap the code to copy it — and call join_session. Always offer both, even if (1) fails: a blocked or failed create_live_handoff call is never the last word, fall back to (2) and still give the potter a way in. The page is live-synced and may change under you: if the browser refuses a call because the page changed, look again and retry.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      title: "Describe current design",
      annotations: { title: "Describe current design", readOnlyHint: true },
      execute: (_input, options) =>
        run("describe_project", options, () => stateResult("Current design.", false)),
    },
    {
      name: "open_model",
      description:
        "Open a design from an Unfolded share link — the full URL or just its query string, e.g. '?type=tapered&height=600&bottom=300&top=100&shrinkage=12&wall=5'. Keys: type, height/bottom/top (fired mm), name, shrinkage (%), wall (mm), paper (A4/A3/Letter). Missing keys keep current values; out-of-range values clamp. Returns the full new state." + LINK_RULE,
      inputSchema: toInputSchema(openModelInput),
      title: "Open model from link",
      annotations: { title: "Open model from link" },
      execute: (input, options) =>
        run("open_model", options, () => {
          const { url } = openModelInput.parse(input ?? {})
          const patches = parseShareParams(url)
          if (!patches.form && !patches.clay && !patches.paperSize) {
            return stateError(
              "No recognizable design parameters in that link. Expected query parameters " +
                "like type, height, bottom, top, name, shrinkage, wall, paper.",
              "Current state unchanged"
            )
          }
          useProjectStore.getState().openModel(patches)
          return stateResult("Model opened from link.")
        }),
    },
    {
      name: "update_design",
      description:
        "Change any subset of the design in ONE call: shape (type, tapered, facets, name), the dimensions in FIRED millimeters, clay (shrinkage and wet slab thickness), paperSize, and the potter's display units ('cm' or 'in' — display only; tool inputs and outputs stay in millimeters regardless). For a target volume pass capacityMl (milliliters) instead of heightMm: volume is linear in height, so this solves the exact height — never iterate. Everything applies together as one undo step and the potter's 3D preview updates at once. Legacy type values 'cylinder' and 'tapered' are accepted. Returns the full new state with capacityMl." +
        LINK_RULE,
      inputSchema: toInputSchema(updateDesignInputSchema),
      title: "Update the design",
      annotations: { title: "Update the design" },
      execute: (input, options) =>
        run("update_design", options, () => {
          const parsed = updateDesignInputSchema.parse(input ?? {})
          const { shrinkagePct, wallThicknessMm, units, paperSize, capacityMl: target, ...formPatch } = parsed
          if (parsed.heightMm !== undefined && target !== undefined) {
            return stateError(
              "Invalid input:\nheightMm and capacityMl: give one or the other — capacityMl solves the height itself.",
              "Current state unchanged"
            )
          }
          const clayPatch: SetClayInput = {}
          if (shrinkagePct !== undefined) clayPatch.shrinkagePct = shrinkagePct
          if (wallThicknessMm !== undefined) clayPatch.wallThicknessMm = wallThicknessMm
          const hasForm = Object.values(formPatch).some((v) => v !== undefined)
          const hasClay = Object.keys(clayPatch).length > 0
          if (!hasForm && !hasClay && !units && !paperSize && target === undefined) {
            return stateResult("No changes requested.")
          }

          const store = useProjectStore.getState()
          // The capacity solve runs against the diameters and clay AFTER the
          // other fields apply, so one call carries the whole sentence — and
          // its feasibility is settled BEFORE anything is written: a failure
          // must leave the design exactly as it was (the advertised failure
          // contract), never with the walls and diameters already committed.
          // applyFormPatch/applyClayPatch are the store's own pure steps.
          let solved: number | null = null
          if (target !== undefined) {
            const nextForm = hasForm ? applyFormPatch(store.form, formPatch as UpdateFormInput) : store.form
            const nextClay = hasClay ? applyClayPatch(store.clay, clayPatch) : store.clay
            solved = heightForCapacityMl(nextForm, nextClay, target)
            if (solved === null) {
              return stateError(
                "The walls close this form's interior entirely — no height can hold anything. " +
                  "Thin the walls (wallThicknessMm) or widen the form first. Nothing was changed.",
                "Current state unchanged"
              )
            }
          }

          const notes: string[] = []
          // one undo scope for the whole call, however many slices it touches
          store.beginUndoCoalescing()
          try {
            // the store action normalizes the legacy type values and then
            // validates with the model's schema — the advertised contract
            // above admits exactly that set
            if (hasForm) store.updateForm(formPatch as UpdateFormInput)
            if (hasClay) store.setClay(clayPatch)
            if (paperSize) store.setPaperSize(paperSize)
            if (units) store.setUnit(units)
            if (hasForm || hasClay || paperSize) notes.push("Design updated.")
            if (units) notes.push(`Display units set to ${units === "in" ? "inches" : "centimeters"}.`)
            if (target !== undefined && solved !== null) {
              const clamped = Math.round(Math.min(600, Math.max(20, solved)) * 10) / 10
              store.updateForm({ heightMm: clamped })
              const { form, clay } = useProjectStore.getState()
              const achieved = capacityMl(form, clay)
              notes.push(
                Math.abs(clamped - solved) > 0.05
                  ? `Target ${target} ml needs a ${solved.toFixed(0)} mm height — clamped to ${clamped} mm, which holds ~${achieved} ml. Adjust the diameters to get closer.`
                  : `Height set to ${clamped} mm — the vessel now holds ~${achieved} ml.`
              )
            }
          } finally {
            store.endUndoCoalescing()
          }
          return stateResult(notes.join(" "))
        }),
    },
    {
      name: "get_template_summary",
      description:
        "Printable template details: each flat piece with wet-clay dimensions and assembly notes, the layout size, glue overlap, and exactly how many PDF pages at the current paper size (A4, A3, or Letter). Read-only.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      title: "Template summary",
      annotations: { title: "Template summary", readOnlyHint: true },
      execute: (_input, options) =>
        run("get_template_summary", options, () => {
          const summary = describeTemplates()
          return textResult(JSON.stringify(summary), false, {
            ok: true,
            message: "Template summary.",
            ...summary,
          })
        }),
    },
    {
      name: "get_preview_image",
      description:
        "See what the potter sees: a compact JPEG of the live 3D preview, small enough to cost little context. Use it to confirm a change visually. If the canvas can't be captured, a text description is returned instead. Read-only.",
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
            const message = `Preview image unavailable (the 3D canvas hasn't rendered in this environment). ${summary}`
            return textResult(message, false, { ok: true, message, summary })
          }
          return {
            content: [
              { type: "image", data: image.data, mimeType: image.mimeType },
              { type: "text", text: summary },
            ],
            structuredContent: { ok: true, message: summary, summary },
          }
        }),
    },
    {
      name: "export_templates",
      description:
        "Export the printable template as a multi-page PDF, downloaded in the potter's browser — remind them to print at 100% scale and check the calibration ruler on page 1. Pages tile the true-scale template with 10 mm glue overlaps. Optionally set paperSize first. Returns the page count and the full new state." +
        LINK_RULE,
      inputSchema: toInputSchema(exportTemplatesInput),
      title: "Export printable PDF",
      annotations: { title: "Export printable PDF" },
      execute: async (input, options) => {
        if (options?.signal?.aborted) return cancelledResult()
        useProjectStore.getState().recordAgentCall("export_templates")
        try {
          const { paperSize } = exportTemplatesInput.parse(input ?? {})
          // Export against the requested paper without mutating design state
          // until the irreversible download has succeeded. A cancellation or
          // exporter failure therefore cannot leave a phantom paper-size edit.
          const result = await useProjectStore.getState().exportPdf(paperSize)
          if (options?.signal?.aborted) return cancelledResult()
          if (paperSize) useProjectStore.getState().setPaperSize(paperSize)
          const message =
            `PDF downloaded in the potter's browser: ${result.pages} pages on ${result.paper} ` +
            `(1 overview + ${result.pages - 1} template pages in a ${result.rows}x${result.cols} grid). ` +
            `Remind the potter to print at 100% scale and verify the calibration ruler.`
          // paperSize is design state, so like every other mutation the
          // result carries the full snapshot beside the export's own numbers
          const state = describeState()
          return textResult(
            stateText(message, state),
            false,
            structured(true, message, state, {
              pages: result.pages,
              paper: result.paper,
              rows: result.rows,
              cols: result.cols,
            })
          )
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return plainError(`Export failed: ${message}`)
        }
      },
    },
    {
      name: "apply_preset",
      description: "Start from a known-good preset (the enum lists them). Overwrites the current form and clay settings (undo_last_change reverts it). Returns the full new state." + LINK_RULE,
      inputSchema: toInputSchema(applyPresetInput),
      title: "Apply a preset",
      annotations: { title: "Apply a preset" },
      execute: (input, options) =>
        run("apply_preset", options, () => {
          const { preset } = applyPresetInput.parse(input ?? {})
          useProjectStore.getState().applyPreset(preset as keyof typeof PRESETS)
          return stateResult(`Preset '${preset}' applied.`)
        }),
    },
    {
      name: "create_live_handoff",
      description:
        "Create a fresh, single-use link that continues this exact design in the same live session on another screen — edits then flow both ways and show in your next read. This is the DEFAULT link tool: call it immediately before returning any Unfolded link — after creating, editing, previewing, or opening a design, and for 'send me the link', 'show me', 'open it', or 'continue in the browser'. Return liveHandoffUrl verbatim: never the current page or address-bar URL, an earlier link, or a reconstructed one. Skip it only when the potter explicitly asks for a permanent, bookmarkable, printable, or independent-copy link (that is designUrl). Expires after 15 minutes and works once. On failure no link exists: retry once, then offer start_pairing.",
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
            // fail closed — no fallback URL of any kind (spec §5)
            return linklessError(
              "A live handoff link could not be created because the pairing service is unavailable. " +
                "No link was generated. Retry once; if it still fails, don't give up on pairing — ask the potter for " +
                "their own six-character code instead (it's in their connection button, top right, two dots → " +
                "Continue on another screen — the code is shown there, tap to copy) and call join_session with it. " +
                "Or use start_pairing to mint one from this tab."
            )
          }
          return textResult(JSON.stringify(handoff), false, {
            ok: true,
            message: "Live handoff link created — return liveHandoffUrl verbatim.",
            ...handoff,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return linklessError(
            `A live handoff link could not be created (${message}). No link was generated. Retry once; if it still ` +
              "fails, ask the potter for their own six-character code instead (connection button, top right, two dots " +
              "→ Continue on another screen — tap the code to copy it) and call join_session with it, or use " +
              "start_pairing to mint one from this tab."
          )
        }
      },
    },
    {
      name: "join_session",
      description:
        "Pair this tab into a live session with the 6-character code from the potter's OTHER device, e.g. 'K7F-3QP'. This tab adopts that session's design (one undo step brings the previous one back); afterwards every edit on any device syncs within about a second. Codes expire in 15 minutes and work once — on failure ask for a fresh one. Returns the full state after joining.",
      inputSchema: toInputSchema(joinSessionInput),
      title: "Join live session",
      annotations: { title: "Join live session" },
      execute: async (input, options) => {
        if (options?.signal?.aborted) return cancelledResult()
        useProjectStore.getState().recordAgentCall("join_session")
        try {
          const { code: raw } = joinSessionInput.parse(input ?? {})
          const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, "")
          if (!PAIR_CODE_RE.test(code)) {
            return stateError(
              "That doesn't look like a pairing code — expected 6 characters like 'K7F-3QP' " +
                "(codes never contain I, L, O, 0 or 1).",
              "Current state unchanged"
            )
          }
          // the signal reaches the claim fetch; a cancel aborts the network
          // call and joinWithCode commits nothing afterwards
          const joined = await liveSync.joinWithCode(code, options?.signal)
          if (options?.signal?.aborted) return cancelledResult()
          if (!joined.ok) {
            return joined.retryable
              ? plainError("The pairing service is busy — wait a minute and try once more.")
              : stateError(
                  "That code didn't work — codes expire after 15 minutes and can be used once. " +
                    "Ask the potter to mint a fresh one.",
                  "Current state unchanged"
                )
          }
          // the session's design arrives with the welcome — wait for it so
          // the returned state is the adopted one
          await liveSync.whenSyncing(8_000)
          if (options?.signal?.aborted) return cancelledResult()
          const others = Math.max(0, liveSync.peers() - 1)
          return stateResult(`Joined live session — now syncing with ${others} other device(s).`)
        } catch (error) {
          if (error instanceof z.ZodError) {
            return stateError("Invalid input: code is required.", "Current state unchanged")
          }
          const message = error instanceof Error ? error.message : String(error)
          return plainError(`Joining failed: ${message}`)
        }
      },
    },
    {
      name: "start_pairing",
      description:
        "Mint a 6-character pairing code for THIS tab's session and tell it to the potter — also mint and give them a liveHandoffUrl link that does the same thing in one tap. Entered on their other device (connection button → Continue on another screen), or opened as a link, that device then FOLLOWS this design — use it when the work lives here and the potter wants it on another screen, e.g. 'put this on my desktop', 'pair from here'. Valid 15 minutes, one use; both devices stay live peers. Returns the full state.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      title: "Start device pairing",
      annotations: { title: "Start device pairing" },
      execute: async (_input, options) => {
        if (options?.signal?.aborted) return cancelledResult()
        useProjectStore.getState().recordAgentCall("start_pairing")
        try {
          // the code and the link are two independent mints for the same
          // session — always attempt both together (the in-app "Continue
          // on another screen" dialog does the same), so the potter never
          // gets the code alone when a tappable link was also possible
          const [minted, handoff] = await Promise.all([liveSync.mintCode(), createLiveHandoff()])
          // a cancel that lands mid-mint: the unused code/token simply
          // expires and the never-peered session forgets itself (solo grace)
          if (options?.signal?.aborted) return cancelledResult()
          if (!minted) {
            return stateError(
              "Couldn't reach the pairing service — it may not be available in this environment. " +
                "The design is unaffected; try again in a moment.",
              "Current state"
            )
          }
          const message =
            `Pairing code: ${prettyCode(minted.code)} — valid 15 minutes, one use. ` +
            "On the other device: the connection button (two dots in the header) → Continue on another screen → " +
            "Enter a code from another screen → type this code." +
            (handoff
              ? ` Or, faster, send them this link and one tap does the same thing: ${handoff.liveHandoffUrl}`
              : "") +
            " That device will adopt this design; afterwards edits sync both ways."
          const state = describeState()
          return textResult(
            stateText(message, state),
            false,
            structured(true, message, state, handoff ? { liveHandoffUrl: handoff.liveHandoffUrl } : undefined)
          )
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return plainError(`Pairing failed: ${message}`)
        }
      },
    },
    {
      name: "undo_last_change",
      description:
        "Undo the most recent change to the design (form, clay, or paper size), whether made by you or by the potter in the UI. Rapid consecutive changes (a slider drag, opening a link) count as one step; 50 steps are kept. Returns the full state after undoing." + LINK_RULE,
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      title: "Undo last change",
      annotations: { title: "Undo last change" },
      execute: (_input, options) =>
        run("undo_last_change", options, () => {
          if (!useProjectStore.getState().undo()) {
            return stateError("Nothing to undo.", "Current state")
          }
          return stateResult("Undid the last change.")
        }),
    },
  ]
  // The profiler's own report tool, so an agent can read the numbers
  // through the host (docs/webmcp-profiler-spec.md §9). Registered
  // only when a ?perf= link armed profiling, so an unarmed session carries
  // no extra schema bytes.
  const profiler = typeof window === "undefined" ? undefined : window.__webmcpPerf
  if (profiler?.active) tools.push(profilerTool(profiler) as unknown as ToolDescriptor)
  return tools
}
