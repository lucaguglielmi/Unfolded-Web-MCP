import { z } from "zod"
import { TOOL_RESULT_CONTRACT } from "@/mcp/modelContext"
import { buildTools } from "@/mcp/tools"
import {
  claySettingsSchema,
  formParamsSchema,
  updateDesignInputSchema,
  DEFAULT_CLAY,
  PRESETS,
} from "@/lib/model/schemas"
import { TYPE_ALIASES } from "@/lib/model/shareLink"
import {
  ANNOTATION_MM,
  PAGE_MARGIN_MM,
  PAGE_OVERLAP_MM,
  PAPERS,
} from "@/lib/export/svg"
import { describe as describeProfiler } from "@/profiler/docs"
import { SESSION_STORAGE_KEY, SYNC_PROTOCOL_VERSION } from "@/store/syncClient"
import { CODE_ALPHABET, CODE_LENGTH, CODE_TTL_MS, TOKEN_TTL_MS } from "../../worker/pairingCore"

/**
 * The machine manifest rendered on /webmcp's "I am not human" view — one
 * JSON object describing the whole application for an agent. Every schema
 * in it is DERIVED at page load from the same zod schemas and tool
 * registrations the app actually runs, so this document can never drift
 * from the code: z.toJSONSchema on the model, buildTools() for the tool
 * surface, the real alias table for share links, the real constants for
 * pairing and layout. Prose fields are spec-voice, written to be parsed.
 */

export function buildAgentManifest(): Record<string, unknown> {
  const tools = buildTools().map((tool) => ({
    name: tool.name,
    title: tool.title ?? (tool.annotations as { title?: string } | undefined)?.title,
    annotations: tool.annotations ?? {},
    description: tool.description,
    inputSchema: tool.inputSchema,
  }))

  return {
    manifest: "unfolded-agent-manifest",
    manifestVersion: 1,
    generated: "at page load, from the live zod schemas and tool registrations — never hand-maintained",
    application: {
      name: "Unfolded",
      purpose:
        "Parametric designer for slab-built pottery: the potter (or you) describes the FIRED piece; the app computes wet-clay, true-scale printable templates via closed-form unrolling of developable surfaces.",
      pipeline: [
        { stage: "state", detail: "one zustand store: {form, clay, paperSize, unit} + undo history. UI sliders and your tools mutate it through the same validated actions." },
        { stage: "geometry", detail: "buildPieces(form, clay) unrolls the wall (rectangle | trapezoid panels | annular sector) and base (disc | polygon), applying shrinkage scaling and mid-surface development." },
        { stage: "layout", detail: "shelf-packing onto the chosen paper's printable width; pagination tiles the layout with glue overlaps; empty tiles are skipped." },
        { stage: "output", detail: "multi-page PDF at 100% scale: overview page (instructions, assembly map, calibration rulers, QR) + template pages (each with its own scale-check bar); the QR of the exact design also prints inside the largest piece." },
        { stage: "sync", detail: "optional live cross-device session over WebSocket (Durable Object per session); patches use the SharePatches wire shape; per-field last-write-wins." },
      ],
      invariants: [
        "all tool I/O lengths are millimeters of the FIRED piece; volumes are milliliters",
        "templates are wet-clay sizes: every dimension is scaled by 1/(1 - shrinkagePct/100)",
        "wallThicknessMm is the WET slab as rolled (the only non-fired input); templates subtract it from wet outer sizes, the interior subtracts the fired wall wallThicknessMm*(1 - shrinkagePct/100) from fired outer sizes",
        "round walls develop on the slab mid-surface: radius used is wet r_outer - wallThicknessMm/2",
        "faceted walls are flat panels cut to the outer face; the corner miter absorbs thickness",
        "straight forms mirror topDiameterMm = bottomDiameterMm; turning taper on without an explicit top flares it to min(300, round(bottom * 1.4))",
        "interior capacity is linear in heightMm at fixed diameters — update_design with capacityMl solves it exactly (after any diameters or clay in the same call apply), never iterate",
        "every mutating tool returns the full new state (form, clay, paperSize, units, capacityMl, pieces, printedPages, warnings, designUrl, session) — snapshots are pure and never spend a live token; session.paired false means a fresh tab: offer the create_live_handoff link ('Open a paired browser session with this chat') first, the six-character code second",
        "designUrl is a permanent permalink (independent copy, no session); liveHandoffUrl is the agent-facing default link from create_live_handoff or start_pairing, while the human Continue dialog uses a separate join-only invitation",
        "invalid input returns isError text with per-field issues AND the unchanged state",
        `every result also carries structuredContent (contract ${TOOL_RESULT_CONTRACT}): ok mirrors !isError, message opens the text, and state — when present — deep-equals the JSON the text serializes`,
      ],
      formulas: {
        shrinkageScale: "s = 1 / (1 - shrinkagePct/100); every template length = fired length * s",
        cylinderWall: "rectangle: width = 2*pi*(D/2 - t/2) * s, height = H * s",
        coneFrustumWall: "annular sector: slant = hypot(rMax-rMin, H); outerR = rMax*slant/(rMax-rMin); innerR = outerR - slant; angle = 2*pi*rMax/outerR (mid-surface radii, then * s)",
        facetedWall: "N panels, width = 2*R*sin(pi/N) at each rim (trapezoid when tapered), miter bevel recomputed for the face lean",
        capacity: "V(h) is linear in h at fixed diameters and clay: solve h for target V in closed form",
      },
    },
    resultContract: {
      version: TOOL_RESULT_CONTRACT,
      envelope: "MCP-style { content: [{type:'text'|'image', ...}], isError } unchanged, plus structuredContent beside it — additive, a host that ignores the field loses nothing",
      invariants: [
        "structuredContent.ok === !isError",
        "structuredContent.message is the sentence the text content opens with",
        "structuredContent.state, when present, deep-equals the JSON in the text (compact from tool-result/2 on)",
      ],
      shapes: {
        stateReporting: "describe_project, open_model, update_design, apply_preset, join_session, start_pairing, undo_last_change → { ok, message, state, warnings? }; state carries form, clay, paperSize, units, designUrl, capacityMl, pieces, printedPages, warnings, session {paired, peers}; start_pairing adds liveHandoffUrl beside them when its link minted (the code alone when it did not); on failure (validation, failed join, nothing to undo, no pairing service) { ok: false, message, state } with the unchanged state",
        create_live_handoff: "{ ok, message, liveHandoffUrl, designUrl, expiresAt, expiresInSeconds, singleUse, instruction }; fail-closed: { ok: false, message } with no state or URL field",
        get_template_summary: "{ ok, message, ...template summary }",
        get_preview_image: "image content unchanged; { ok, message, summary }",
        export_templates: "{ ok, message, pages, paper, rows, cols, state, warnings? }",
        cancelled: "any tool aborted by the host's signal → { ok: false, message }",
      },
    },
    tools,
    dataModel: {
      formParams: z.toJSONSchema(formParamsSchema),
      claySettings: z.toJSONSchema(claySettingsSchema),
      updateDesignInput: z.toJSONSchema(updateDesignInputSchema),
      presets: PRESETS,
      defaults: { form: "presets['classic-mug']", clay: DEFAULT_CLAY, paperSize: "A4", unit: "cm" },
      papers: PAPERS,
      displayUnits: ["cm", "in"],
    },
    shareLinks: {
      contract:
        "the whole design as URL query parameters; origin-independent; parsing is forgiving (unknown keys ignored, malformed numbers dropped, out-of-range clamped); parameters missing from a link keep current values; NEVER a live-session capability",
      example: "?type=tapered&height=600&bottom=300&top=100&shrinkage=12&wall=5&paper=A4&units=cm",
      parameters: {
        type: { accepts: Object.keys(TYPE_ALIASES), aliasTable: TYPE_ALIASES },
        height: { mapsTo: "form.heightMm", range: [20, 600], unit: "fired mm" },
        bottom: { mapsTo: "form.bottomDiameterMm", range: [20, 500], unit: "fired mm" },
        top: { mapsTo: "form.topDiameterMm", range: [20, 500], unit: "fired mm", note: "an explicit top implies tapered=true" },
        tapered: { accepts: ["1", "0", "true", "false"] },
        facets: { mapsTo: "form.facets", range: [3, 8], rounded: true },
        name: { mapsTo: "form.name", maxLength: 60 },
        shrinkage: { mapsTo: "clay.shrinkagePct", range: [0, 25], unit: "percent" },
        wall: { mapsTo: "clay.wallThicknessMm", range: [2, 15], unit: "mm" },
        paper: { accepts: ["A4", "A3", "Letter"] },
        units: { accepts: ["cm", "in", "inch", "inches", "metric"] },
        via: { emitOnly: "chatgpt", meaning: "set only on liveHandoffUrl — the opening tab shows 'Opened from ChatGPT' (provenance; pairing is confirmed separately by the sync dot)" },
      },
    },
    liveSync: {
      summary:
        "optional cross-device session: any paired tab's edits reach all peers in ~1s. Pairing is by 6-character code or by single-use link, and both tools serve both: start_pairing mints a code AND a liveHandoffUrl for this session, create_live_handoff mints the link alone; the Continue dialog behind the header's connection button shows the same pair (QR + link + code) to the human. A code or live link in the clipboard also raises a one-tap join offer in the app (src/lib/pairingOffer.ts). Rule: the device that ENTERS a code or OPENS a link adopts the minting session's design (one undo step). After joining, no device is special.",
      pairingCode: {
        alphabet: CODE_ALPHABET,
        length: CODE_LENGTH,
        regex: `^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`,
        normalization: "uppercase, strip all non-alphanumerics ('k7f-3qp' == 'K7F3QP')",
        ttlMs: CODE_TTL_MS,
        singleUse: true,
        miss: "unknown, expired, and already-used codes are indistinguishable by design",
      },
      joinToken: {
        what: "the URL-borne sibling of a code, minted on demand by create_live_handoff (and alongside the code by start_pairing): liveHandoffUrl carries ?join=<single-use token> — the tab that opens it silently follows YOUR session (both ways) and strips the parameter. Call the tool right before replying with a link and return liveHandoffUrl verbatim. A mint that lost its race with a cold session socket is retried inside the tool, so a reported failure is already the second attempt: yield no link, and offer the potter's own six-character code (join_session) instead.",
        regex: "^[A-Za-z0-9_-]{20,64}$",
        ttlMs: TOKEN_TTL_MS,
        singleUse: true,
        privacyRule: "no URL ever carries a durable capability — at most this single-use, short-lived claim ticket, dead after its first open; the printed PDF QR stays parameter-only",
      },
      transport: {
        endpoint: "wss://<origin>/api/session/{sid}/ws",
        claim: "POST /api/pair/claim {code: <six-character code or join token>} -> {ok, sid} | 404 {ok, retryable}",
        protocolVersion: SYNC_PROTOCOL_VERSION,
        clientToServer: {
          hello: { protocolVersion: "number", clientId: "string", actor: "'human'|'agent'", state: "DesignSlice? (first-contact bootstrap only)" },
          patch: { patchId: "string", baseVersion: "number", patches: "SharePatches" },
          mint_code: {},
          mint_token: {},
          bye: {},
        },
        serverToClient: {
          welcome: { state: "DesignSlice", version: "number", peers: "number" },
          patch: { version: "number", patches: "SharePatches", clientId: "string", actor: "string", note: "broadcast to ALL including sender — the echo teaches the sender its new version" },
          resync: { state: "DesignSlice", version: "number" },
          presence: { peers: "number" },
          code: { code: "string", expiresAt: "epoch ms" },
          token: { token: "string", expiresAt: "epoch ms" },
          error: { code: "string", message: "string" },
        },
      },
      semantics: [
        "wire shape for every change is SharePatches — the same vocabulary as share links",
        "merging is per-field last-write-wins; simultaneous edits to different fields both win",
        "a version gap triggers a fresh hello -> full snapshot resync",
        "peers' patches apply through the same validated path as the potter's edits and land as single undo steps",
        "sessions are unlisted, hold only the design slice, and self-delete after 30 idle days",
      ],
      storageKey: SESSION_STORAGE_KEY,
    },
    // the package describes itself (docs/webmcp-profiler-spec.md §9);
    // only profilerNotes is written by hand
    profiler: describeProfiler({}, "get_perf_report"),
    profilerNotes: {
      howToProfileYourself:
        "open_model any URL of this site with ?perf=1 (persists for the tab's origin, survives the app rewriting its URL), work normally, then call get_perf_report — it is registered as the twelfth tool while profiling is armed. Start with view=summary; ask for spans only when you need individual calls.",
      knownFindings: [
        "every tool here executes in single-digit milliseconds (p50 <= 5 ms) — perceived latency is host/model round-trip time, not page compute",
        "get_preview_image returns a deliberately compact 320px JPEG (~7 KB, ~1.7K tokens); it was a 480px PNG (~130 KB, ~32K tokens) before profiling flagged it",
      ],
      source: "packages/webmcp-profiler in the repo (npm: webmcp-profiler) — dependency-free, drops into any WebMCP project; specs at docs/webmcp-profiler-spec.md and docs/webmcp-profiler-0.2-spec.md",
    },
    layoutConstants: {
      pageMarginMm: PAGE_MARGIN_MM,
      glueOverlapMm: PAGE_OVERLAP_MM,
      annotationRowMm: ANNOTATION_MM,
      templateQrMm: 22,
    },
    interactionModel: {
      undo: { historyLimit: 50, coalesceWindowMs: 800, note: "a slider drag, an opened link, or a preset counts as ONE step; undo_last_change reverts your edits and the potter's alike" },
      persistence: "the design survives reloads via localStorage 'unfolded:project:v1'; an explicit share link at boot outranks it",
      urlBar: "the address bar live-tracks the design after the first edit — it is always a valid share link",
      consoleHook: "window.__unfoldedTools.<name>.execute(input) drives any registered tool without an agent host",
    },
  }
}
