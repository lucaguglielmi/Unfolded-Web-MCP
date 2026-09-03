import { describe, expect, it } from "vitest"
import { buildTools } from "./tools"

/**
 * The standard prompt suite: representative things a
 * potter says to an agent, each mapped to the tool that should handle it
 * and the discriminating phrases that make an agent PICK that tool. The
 * phrases are the load-bearing contract sentences of the discovery
 * metadata — any future trim that cuts one fails here, which is exactly
 * the guard that makes trimming safe.
 *
 * Alongside it, a metadata budget: the whole discovery payload (names,
 * descriptions, schemas, annotations — what a host serializes into the
 * model's context on every conversation) must stay under budget. Baseline
 * before the 9.1 trim was 11,360 chars; the trim landed at ~9,000.
 */

const metadataOf = (tool: {
  name: string
  description: string
  inputSchema: unknown
  annotations?: unknown
}) => JSON.stringify({ n: tool.name, d: tool.description, s: tool.inputSchema, a: tool.annotations })

/** prompt → expected tool → phrases its metadata must contain (case-insensitive) */
const PROMPT_SUITE: { prompt: string; tool: string; mustMention: string[] }[] = [
  {
    prompt: "What am I designing right now?",
    tool: "describe_project",
    mustMention: ["what am i designing", "depends on what is there now", "designurl", "capacityml"],
  },
  {
    // docs/webmcp-tool-performance-spec.md §6.1: a fresh
    // session is offered the paired-browser link first and the spoken code
    // second — but BOTH, even when the link fails, and the code's place in
    // the UI is named so "send me a code" isn't a puzzle
    prompt: "Connect to tryunfolded.com",
    tool: "describe_project",
    mustMention: [
      "session.paired",
      "paired browser session",
      "create_live_handoff",
      "six-character",
      "continue on another screen",
      "even if (1) fails",
    ],
  },
  {
    prompt: "Make it hold about 350 ml.",
    tool: "update_design",
    mustMention: ["milliliters", "solves the exact height", "never iterate"],
  },
  {
    prompt: "My stoneware shrinks 13% — adjust my templates.",
    tool: "update_design",
    mustMention: ["shrinkage"],
  },
  {
    prompt: "Make it a hexagonal planter, 18 cm tall.",
    tool: "update_design",
    mustMention: ["hexagon", "fired", "millimeters"],
  },
  {
    // tool-performance spec §4: an absolute edit needs no read first
    prompt: "Make it 12 cm tall.",
    tool: "update_design",
    mustMention: ["one call", "one undo step", "full new state"],
  },
  {
    prompt: "Switch to inches.",
    tool: "update_design",
    mustMention: ["display", "millimeters regardless"],
  },
  {
    prompt: "Export the PDF for A4.",
    tool: "export_templates",
    mustMention: ["100% scale", "calibration"],
  },
  {
    prompt: "Join my desktop session, code K7F-3QP.",
    tool: "join_session",
    mustMention: ["code", "adopts"],
  },
  {
    // live-handoff-link-spec §7.1: this phrasing routes here,
    // so the LINK has to be advertised here too — a code-only answer was
    // the bug ("pair from here" got six characters and nothing to tap)
    prompt: "Put this design on my desktop screen.",
    tool: "start_pairing",
    mustMention: ["other device", "follows this design", "liveHandoffUrl"],
  },
  {
    prompt: "Undo that.",
    tool: "undo_last_change",
    mustMention: ["you or by the potter"],
  },
  {
    prompt: "Show me how it looks.",
    tool: "get_preview_image",
    mustMention: ["what the potter sees"],
  },
  {
    prompt: "Start me from a mug preset.",
    tool: "apply_preset",
    mustMention: ["overwrites", "undo_last_change"],
  },
  {
    prompt: "Open ?type=hexagon&height=180 for me.",
    tool: "open_model",
    mustMention: ["share link", "clamp"],
  },
  {
    prompt: "How many pages will the template print on?",
    tool: "get_template_summary",
    mustMention: ["pages"],
  },
  {
    prompt: "Send me the link.",
    tool: "create_live_handoff",
    mustMention: ["default link tool", "verbatim", "address-bar", "works once"],
  },
]

/**
 * Room above the current size, tight enough that metadata cannot quietly
 * balloon. Raising this number is a deliberate review decision, not a fix;
 * the current tool descriptions and schemas are the measured surface.
 */
const METADATA_BUDGET_CHARS = 9_350

describe("prompt suite — tool selection signals survive metadata trims", () => {
  const tools = buildTools()
  const byName = new Map(tools.map((tool) => [tool.name, tool]))

  for (const { prompt, tool, mustMention } of PROMPT_SUITE) {
    it(`"${prompt}" → ${tool}`, () => {
      const descriptor = byName.get(tool)
      expect(descriptor, `tool ${tool} must exist`).toBeDefined()
      const haystack = metadataOf(descriptor!).toLowerCase()
      for (const phrase of mustMention) {
        expect(haystack, `${tool} metadata must mention "${phrase}"`).toContain(
          phrase.toLowerCase()
        )
      }
    })
  }

  it("describe_project no longer asks to be called first", () => {
    // tool-performance spec §4: the sentence made agents spend a read round trip before
    // absolute edits whose result carries the same snapshot anyway
    expect(byName.get("describe_project")!.description.toLowerCase()).not.toContain("call this first")
  })

  it("every tool that creates, edits, or opens a design carries the link rule", () => {
    const linkTools = ["open_model", "update_design", "apply_preset", "undo_last_change", "export_templates"]
    for (const name of linkTools) {
      expect(byName.get(name)!.description, `${name} must route links to create_live_handoff`).toContain("create_live_handoff")
    }
  })

  it("update_design routes target volumes to capacityMl, never a height loop", () => {
    // the single most valuable routing sentence: without it agents
    // guess-loop heightMm toward a volume the solver answers exactly
    expect(metadataOf(byName.get("update_design")!).toLowerCase()).toContain("never iterate")
  })

  it("every tool that changes the design promises the full new state", () => {
    // reads carry no promise; create_live_handoff mints a link and changes
    // nothing, so it returns the handoff object instead
    const exempt = new Set(["describe_project", "get_template_summary", "get_preview_image", "create_live_handoff"])
    for (const tool of buildTools()) {
      if (exempt.has(tool.name)) continue
      expect(
        /full (new )?state/i.test(tool.description),
        `${tool.name} must promise the full state`
      ).toBe(true)
    }
  })

  it("total discovery metadata stays under budget", () => {
    const total = buildTools().reduce((sum, tool) => sum + metadataOf(tool).length, 0)
    expect(total).toBeLessThanOrEqual(METADATA_BUDGET_CHARS)
    // and it should stay a real surface, not an over-trimmed stub
    expect(total).toBeGreaterThan(6_000)
  })
})
