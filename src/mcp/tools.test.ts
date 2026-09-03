import { describe, expect, it } from "vitest"
import { buildTools, TOOL_SUMMARIES } from "./tools"

describe("tool surface", () => {
  it("update_design advertises the legacy type values its normalizer accepts", () => {
    const tool = buildTools().find((t) => t.name === "update_design")!
    const schema = tool.inputSchema as { properties: Record<string, { enum?: string[] }> }
    expect(schema.properties.type.enum).toEqual(["round", "faceted", "cylinder", "tapered"])
    // the merged contract: form, clay, units, paper, and the capacity solve
    expect(Object.keys(schema.properties).sort()).toEqual(
      ["bottomDiameterMm", "capacityMl", "facets", "heightMm", "name", "paperSize", "shrinkagePct", "tapered", "topDiameterMm", "type", "units", "wallThicknessMm"]
    )
    expect(schema.properties.units.enum).toEqual(["cm", "in"])
    expect(schema.properties.paperSize.enum).toEqual(["A4", "A3", "Letter"])
  })

  it("the surface is eleven tools", () => {
    expect(buildTools().map((t) => t.name)).toEqual([
      "describe_project",
      "open_model",
      "update_design",
      "get_template_summary",
      "get_preview_image",
      "export_templates",
      "apply_preset",
      "create_live_handoff",
      "join_session",
      "start_pairing",
      "undo_last_change",
    ])
  })

  it("TOOL_SUMMARIES matches buildTools() name-for-name, in order", () => {
    // /webmcp renders TOOL_SUMMARIES; this pins it to the real registrations
    expect(TOOL_SUMMARIES.filter((s) => !s.conditional).map((s) => s.name)).toEqual(buildTools().map((t) => t.name))
  })

  it("every tool has a real description and an object input schema", () => {
    for (const tool of buildTools()) {
      expect(tool.description.length).toBeGreaterThan(40)
      expect((tool.inputSchema as { type?: string }).type).toBe("object")
    }
  })
})
