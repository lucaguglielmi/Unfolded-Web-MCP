import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Structured results (hardening spec 9.3, contract tool-result/1): every
 * tool keeps its text `content` exactly as before and ADDITIONALLY returns
 * `structuredContent` — `{ ok, message, state?, warnings? }` for the
 * state-reporting tools, the tool's own object (plus ok/message) for the
 * rest. This suite drives every tool through success and failure paths
 * and pins the two invariants a host can rely on: `ok` mirrors `!isError`,
 * and a `state` field is byte-for-byte the JSON the text serializes.
 *
 * It also prints the payload measurement the report records: text bytes
 * versus structured bytes for describe_project and update_form.
 */

const { mintToken, mintCode, joinWithCode } = vi.hoisted(() => ({
  mintToken: vi.fn<() => Promise<{ token: string; expiresAt: number } | null>>(),
  mintCode: vi.fn<() => Promise<{ code: string; expiresAt: number } | null>>(),
  joinWithCode: vi.fn<() => Promise<{ ok: boolean; retryable?: boolean }>>(),
}))

vi.mock("@/store/syncClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/store/syncClient")>()
  return {
    ...actual,
    liveSync: {
      ...actual.liveSync,
      mintToken,
      mintCode,
      joinWithCode,
      whenSyncing: async () => true,
      peers: () => 2,
    },
  }
})

const { buildTools } = await import("./tools")
const { describeState, describeTemplates } = await import("./describe")
const { TOOL_RESULT_CONTRACT } = await import("./modelContext")
const { useProjectStore } = await import("@/store/useProjectStore")

const tool = (name: string) => buildTools().find((t) => t.name === name)!
const call = async (name: string, input: unknown = {}) => {
  const result = await tool(name).execute(input)
  const text = result.content.find((c) => c.type === "text")?.text ?? ""
  return { result, text, isError: result.isError === true, structured: result.structuredContent }
}

/** the pretty-printed state JSON is the text itself (reads) or follows a
    "\n{\n" boundary after the message (mutations and failures) */
const stateJsonIn = (text: string): unknown => {
  const start = text.startsWith("{\n") ? 0 : text.indexOf("\n{\n") + 1
  expect(start, "text must carry a pretty-printed state object").toBeGreaterThanOrEqual(0)
  return JSON.parse(text.slice(start))
}

/** one representative call per tool — the success path where the test
    environment can reach it, a deterministic failure where it cannot */
const EVERY_TOOL: { name: string; input?: unknown; expectError?: boolean }[] = [
  { name: "describe_project" },
  { name: "open_model", input: { url: "?type=hexagon&height=150" } },
  { name: "update_form", input: { heightMm: 140 } },
  { name: "set_clay", input: { shrinkagePct: 11 } },
  { name: "set_units", input: { units: "in" } },
  { name: "set_capacity", input: { capacityMl: 300 } },
  { name: "get_template_summary" },
  { name: "get_preview_image" },
  { name: "export_templates", input: {} },
  { name: "apply_preset", input: { preset: "tumbler" } },
  { name: "create_live_handoff" },
  { name: "join_session", input: { code: "K7F-3QP" } },
  { name: "start_pairing" },
  { name: "undo_last_change" },
]

beforeEach(() => {
  mintToken.mockReset()
  mintToken.mockResolvedValue({ token: `tok_${"x".repeat(28)}`, expiresAt: Date.now() + 10 * 60_000 })
  mintCode.mockReset()
  mintCode.mockResolvedValue({ code: "K7F3QP", expiresAt: Date.now() + 10 * 60_000 })
  joinWithCode.mockReset()
  joinWithCode.mockResolvedValue({ ok: true })
  useProjectStore.getState().applyPreset("classic-mug")
  // no PDF pipeline in node: stand in for the real exporter's result shape
  useProjectStore.setState({
    exportPdf: async () => ({ pages: 3, paper: "A4", rows: 1, cols: 2 }) as never,
  })
})

describe(`structured results — ${TOOL_RESULT_CONTRACT}`, () => {
  it("names every tool exactly once", () => {
    expect(EVERY_TOOL.map((c) => c.name).sort()).toEqual(buildTools().map((t) => t.name).sort())
  })

  for (const { name, input } of EVERY_TOOL) {
    it(`${name}: structuredContent present, ok mirrors !isError, state matches the text`, async () => {
      const { result, text, isError, structured } = await call(name, input)
      expect(result.content.length).toBeGreaterThan(0)
      expect(structured, "structuredContent must be present").toBeDefined()
      expect(typeof structured!.ok).toBe("boolean")
      expect(typeof structured!.message).toBe("string")
      expect(structured!.message.length).toBeGreaterThan(0)
      expect(structured!.ok).toBe(!isError)
      if ("state" in structured!) {
        expect(structured!.state).toEqual(stateJsonIn(text))
        const state = structured!.state as { warnings: string[] }
        if (state.warnings.length > 0) expect(structured!.warnings).toEqual(state.warnings)
        else expect("warnings" in structured!).toBe(false)
      }
    })
  }

  it("the text content is untouched: reads are bare JSON, mutations are message + JSON", async () => {
    const read = await call("describe_project")
    expect(read.text).toBe(JSON.stringify(describeState(), null, 2))
    expect(read.structured).toEqual({ ok: true, message: "Current design.", state: describeState() })

    const edit = await call("update_form", { heightMm: 140 })
    expect(edit.text).toBe(`Form updated.\n${JSON.stringify(describeState(), null, 2)}`)
    expect(edit.structured!.message).toBe("Form updated.")
    expect(edit.structured!.state).toEqual(describeState())
  })

  it("validation errors: ok:false, the message, and the unchanged state", async () => {
    const before = describeState()
    const { text, isError, structured } = await call("update_form", { heightMm: -5 })
    expect(isError).toBe(true)
    expect(text).toMatch(/^Invalid input:\n/)
    expect(text).toContain("\n\nCurrent state unchanged:\n")
    expect(structured!.ok).toBe(false)
    expect(structured!.message).toMatch(/^Invalid input:\n/)
    expect(structured!.message).not.toContain("Current state unchanged")
    expect(structured!.state).toEqual(before)
    expect(structured!.state).toEqual(stateJsonIn(text))
  })

  it("a failed join: ok:false with the unchanged state", async () => {
    joinWithCode.mockResolvedValueOnce({ ok: false, retryable: false })
    const before = describeState()
    const { isError, structured } = await call("join_session", { code: "K7F-3QP" })
    expect(isError).toBe(true)
    expect(structured).toMatchObject({ ok: false, state: before })
    expect(structured!.message).toContain("didn't work")

    const { structured: bad } = await call("join_session", { code: "nope" })
    expect(bad).toMatchObject({ ok: false, state: before })
  })

  it("fail-closed handoff: ok:false, message, no liveHandoffUrl", async () => {
    mintToken.mockResolvedValueOnce(null)
    const { isError, structured } = await call("create_live_handoff")
    expect(isError).toBe(true)
    expect(structured!.ok).toBe(false)
    expect(structured!.message).toContain("could not be created")
    expect("liveHandoffUrl" in structured!).toBe(false)
    expect(structured!.state).toEqual(describeState())
  })

  it("create_live_handoff: the handoff object plus ok/message", async () => {
    const { text, structured } = await call("create_live_handoff")
    const { ok, message, ...handoff } = structured!
    expect(ok).toBe(true)
    expect(message).toContain("verbatim")
    expect(handoff).toEqual(JSON.parse(text))
    expect(handoff.liveHandoffUrl).toMatch(/join=tok_/)
  })

  it("get_template_summary: the summary object plus ok/message", async () => {
    const { text, structured } = await call("get_template_summary")
    const { ok, message, ...summary } = structured!
    expect(ok).toBe(true)
    expect(typeof message).toBe("string")
    expect(summary).toEqual(JSON.parse(text))
    expect(summary).toEqual(describeTemplates())
  })

  it("get_preview_image: image content kept, structured carries the summary", async () => {
    const { result, structured } = await call("get_preview_image")
    // node has no canvas: the designed text fallback, still ok:true
    expect(result.content[0]!.type).toBe("text")
    expect(structured!.ok).toBe(true)
    expect(typeof structured!.summary).toBe("string")
    expect(structured!.summary as string).toMatch(/^3D preview of/)
  })

  it("export_templates: ok, message, pages, paper, rows, cols", async () => {
    const { text, structured } = await call("export_templates", { paperSize: "A4" })
    expect(structured).toEqual({ ok: true, message: text, pages: 3, paper: "A4", rows: 1, cols: 2 })
  })

  it("undo with an empty history: ok:false with the current state", async () => {
    useProjectStore.setState({ history: [] } as never)
    const { isError, text, structured } = await call("undo_last_change")
    expect(isError).toBe(true)
    expect(text).toMatch(/^Nothing to undo\.\n\nCurrent state:\n/)
    expect(structured).toMatchObject({ ok: false, message: "Nothing to undo." })
    expect(structured!.state).toEqual(stateJsonIn(text))
  })

  it("host cancellation: ok:false, no state", async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await tool("update_form").execute({ heightMm: 100 }, { signal: controller.signal })
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toEqual({
      ok: false,
      message: "Cancelled by the host before completing — no changes were made.",
    })
  })

  it("measures text vs structured payload bytes (recorded in docs/performance-report.md)", async () => {
    const bytes = (value: string) => new TextEncoder().encode(value).length
    const rows: string[] = []
    for (const [name, input] of [
      ["describe_project", {}],
      ["update_form", { heightMm: 140 }],
    ] as const) {
      const { text, structured } = await call(name, input)
      const textBytes = bytes(text)
      const structuredBytes = bytes(JSON.stringify(structured))
      const stateCompact = bytes(JSON.stringify(structured!.state))
      rows.push(
        `${name}: text ${textBytes} B (pretty JSON) | structuredContent ${structuredBytes} B (compact) ` +
          `| state alone ${stateCompact} B | envelope total ${textBytes + structuredBytes} B`
      )
      expect(structuredBytes).toBeGreaterThan(0)
      expect(structuredBytes).toBeLessThan(textBytes)
    }
    console.info(`[${TOOL_RESULT_CONTRACT} payload]\n  ${rows.join("\n  ")}`)
  })
})
