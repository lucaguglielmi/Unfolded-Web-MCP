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
    mustMention: ["call this first", "designurl", "capacityml"],
  },
  {
    prompt: "Make it hold about 350 ml.",
    tool: "set_capacity",
    mustMention: ["milliliters", "solves the exact height"],
  },
  {
    prompt: "My stoneware shrinks 13% — adjust my templates.",
    tool: "set_clay",
    mustMention: ["shrinkage"],
  },
  {
    prompt: "Make it a hexagonal planter, 18 cm tall.",
    tool: "update_form",
    mustMention: ["hexagon", "fired", "millimeters"],
  },
  {
    prompt: "Switch to inches.",
    tool: "set_units",
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
    prompt: "Put this design on my desktop screen.",
    tool: "start_pairing",
    mustMention: ["other device", "follows this design"],
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
 * Room above the current size, tight enough that metadata can't quietly
 * balloon. Raising this number is a deliberate decision, not a fix. History:
 * the 9.1 trim cut 11,360 → 9,128 chars under a 9,800 budget; the fourteenth
 * tool (create_live_handoff, with the one-sentence link rule on every
 * editing tool — docs/live-handoff-link-spec.md) raised it, on purpose, to
 * 10,474 under an 11,000 budget; the schema-weight trim that followed the
 * first native-host measurement (docs/performance-report.md §1.2) cut
 * property descriptions that restated their own bounds and enums, and
 * descriptions that restated their schemas, down to ~9,030 chars.
 */
const METADATA_BUDGET_CHARS = 9_500

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

  it("every tool that creates, edits, or opens a design carries the link rule", () => {
    const linkTools = ["open_model", "update_form", "set_clay", "set_capacity", "set_units", "apply_preset", "undo_last_change"]
    for (const name of linkTools) {
      expect(byName.get(name)!.description, `${name} must route links to create_live_handoff`).toContain("create_live_handoff")
    }
  })

  it("update_form defers target volumes to set_capacity", () => {
    // the single most valuable routing sentence: without it agents
    // guess-loop update_form toward a volume the solver answers exactly
    expect(byName.get("update_form")!.description).toContain("prefer set_capacity")
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
