import { describe, expect, it } from "vitest"
import { buildTools, TOOL_SUMMARIES } from "./tools"

describe("tool surface", () => {
  it("update_form advertises the legacy type values its normalizer accepts", () => {
    const tool = buildTools().find((t) => t.name === "update_form")!
    const schema = tool.inputSchema as { properties: { type: { enum: string[] } } }
    expect(schema.properties.type.enum).toEqual(["round", "faceted", "cylinder", "tapered"])
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
