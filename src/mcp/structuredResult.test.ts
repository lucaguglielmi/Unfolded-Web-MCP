import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Structured results (contract tool-result/2): every
 * tool keeps its text `content` (compact JSON from contract 2 on) and ADDITIONALLY returns
 * `structuredContent` — `{ ok, message, state?, warnings? }` for the
 * state-reporting tools (start_pairing adds `liveHandoffUrl` beside them
 * when its link minted), the tool's own object (plus ok/message) for the
 * rest. This suite drives every tool through success and failure paths
 * and pins the two invariants a host can rely on: `ok` mirrors `!isError`,
 * and a `state` field is byte-for-byte the JSON the text serializes.
 *
 * It also prints the payload measurement the report records: text bytes
 * versus structured bytes for describe_project and update_design.
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

/** the compact state JSON is the text itself (reads) or follows a
    "\n{" boundary after the message (mutations and failures) */
const stateJsonIn = (text: string): unknown => {
  const start = text.startsWith("{") ? 0 : text.indexOf("\n{") + 1
  expect(start, "text must carry a state object").toBeGreaterThanOrEqual(0)
  return JSON.parse(text.slice(start))
}

/** one representative call per tool — the success path where the test
    environment can reach it, a deterministic failure where it cannot */
const EVERY_TOOL: { name: string; input?: unknown; expectError?: boolean }[] = [
  { name: "describe_project" },
  { name: "open_model", input: { url: "?type=hexagon&height=150" } },
  { name: "update_design", input: { heightMm: 140, shrinkagePct: 11, units: "in" } },
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
        const state = structured!.state as { warnings: string[]; session: { paired: boolean; peers: number } }
        if (state.warnings.length > 0) expect(structured!.warnings).toEqual(state.warnings)
        else expect("warnings" in structured!).toBe(false)
        // §6.2: the snapshot says whether the tab is paired — a fact, not a guess
        expect(typeof state.session.paired).toBe("boolean")
        expect(typeof state.session.peers).toBe("number")
        // §5: the two constants are gone from every snapshot
        expect("linkMode" in (state as object)).toBe(false)
        expect("liveHandoffTool" in (state as object)).toBe(false)
      }
    })
  }

  it("the text content: reads are bare compact JSON, mutations are message + compact JSON", async () => {
    const read = await call("describe_project")
    expect(read.text).toBe(JSON.stringify(describeState()))
    expect(read.structured).toEqual({ ok: true, message: "Current design.", state: describeState() })

    const edit = await call("update_design", { heightMm: 140 })
    expect(edit.text).toBe(`Design updated.\n${JSON.stringify(describeState())}`)
    expect(edit.structured!.message).toBe("Design updated.")
    expect(edit.structured!.state).toEqual(describeState())
  })

  it("update_design: one call carries shape, clay, paper, units and a capacity solve, as one undo step", async () => {
    const before = describeState()
    const { isError, structured } = await call("update_design", {
      type: "hexagon" as never,
      facets: 6,
      bottomDiameterMm: 140,
      shrinkagePct: 13,
      units: "in",
      paperSize: "A3",
      capacityMl: 1200,
    })
    // 'hexagon' is share-link vocabulary, not a form type: the schema rejects it
    expect(isError).toBe(true)
    expect(structured!.state).toEqual(before)

    const ok = await call("update_design", {
      type: "faceted",
      facets: 6,
      bottomDiameterMm: 140,
      shrinkagePct: 13,
      units: "in",
      paperSize: "A3",
      capacityMl: 1200,
    })
    const state = ok.structured!.state as ReturnType<typeof describeState>
    expect(ok.isError).toBe(false)
    expect(state.form.type).toBe("faceted")
    expect(state.form.facets).toBe(6)
    expect(state.clay.shrinkagePct).toBe(13)
    expect(state.units).toBe("in")
    expect(state.paperSize).toBe("A3")
    expect(Math.abs(state.capacityMl - 1200)).toBeLessThanOrEqual(12)
    expect(ok.structured!.message).toMatch(/^Design updated\. Display units set to inches\. Height set to/)
    // one undo step reverts the whole call (units are a display setting, not history)
    const undone = await call("undo_last_change")
    const back = undone.structured!.state as ReturnType<typeof describeState>
    expect(back.form).toEqual(before.form)
    expect(back.clay).toEqual(before.clay)
    expect(back.paperSize).toEqual(before.paperSize)
  })

  it("update_design: an infeasible capacity solve commits nothing — clay and diameters stay as they were", async () => {
    // walls that close the interior: 15 mm slabs on a 25 mm base. The
    // solve is checked BEFORE any write, so the failure leaves the design
    // untouched (the advertised failure contract), not with the thick
    // walls already committed and synced
    const before = describeState()
    const historyBefore = useProjectStore.getState().history.length
    const { isError, text, structured } = await call("update_design", {
      wallThicknessMm: 15,
      bottomDiameterMm: 25,
      capacityMl: 350,
    })
    expect(isError).toBe(true)
    expect(text).toMatch(/Nothing was changed/)
    expect(structured).toMatchObject({ ok: false, state: before })
    expect(describeState()).toEqual(before)
    // and no undo step was burned
    expect(useProjectStore.getState().history.length).toBe(historyBefore)
  })

  it("update_design: heightMm and capacityMl together is a validation error with the unchanged state", async () => {
    const before = describeState()
    const { isError, text, structured } = await call("update_design", { heightMm: 100, capacityMl: 300 })
    expect(isError).toBe(true)
    expect(text).toMatch(/^Invalid input:\nheightMm and capacityMl/)
    expect(structured).toMatchObject({ ok: false, state: before })
  })

  it("update_design: legacy type values are advertised and accepted", async () => {
    const { isError, structured } = await call("update_design", { type: "tapered" })
    const state = structured!.state as ReturnType<typeof describeState>
    expect(isError).toBe(false)
    expect(state.form.type).toBe("round")
    expect(state.form.tapered).toBe(true)
  })

  it("update_design: an empty patch is not an error", async () => {
    const { isError, structured } = await call("update_design", {})
    expect(isError).toBe(false)
    expect(structured!.message).toBe("No changes requested.")
    expect(structured!.state).toEqual(describeState())
  })

  it("validation errors: ok:false, the message, and the unchanged state", async () => {
    const before = describeState()
    const { text, isError, structured } = await call("update_design", { heightMm: -5 })
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

  it("fail-closed handoff: ok:false, message, and no URL anywhere — not even a state snapshot", async () => {
    // every attempt fails: a single cold mint is retried, an outage is not
    mintToken.mockResolvedValue(null)
    const { isError, structured } = await call("create_live_handoff")
    expect(isError).toBe(true)
    expect(structured!.ok).toBe(false)
    expect(structured!.message).toContain("could not be created")
    // docs/live-handoff-link-spec.md §7: a failure returns no clickable URL
    // of any kind — a state snapshot would smuggle designUrl back in
    expect(Object.keys(structured!).sort()).toEqual(["message", "ok"])
    expect(JSON.stringify(structured)).not.toMatch(/https?:\/\/|\?type=/)
  })

  it("start_pairing: the spoken code and the tappable link, from one call", async () => {
    // live-handoff-link-spec §8.3's amendment — a code-only answer to
    // "pair from here" was the bug this closed
    const { isError, text, structured } = await call("start_pairing")
    expect(isError).toBe(false)
    expect(text).toMatch(/K7F-3QP/)
    expect(structured!.liveHandoffUrl).toMatch(/join=tok_/)
    expect(text).toContain(structured!.liveHandoffUrl as string)
    // the code stays the tool's own contract: state rides along as ever
    expect(structured!.state).toEqual(describeState())
  })

  it("start_pairing: a failed token mint costs the link, never the pairing", async () => {
    mintToken.mockResolvedValue(null)
    const { isError, text, structured } = await call("start_pairing")
    expect(isError).toBe(false)
    expect(text).toMatch(/K7F-3QP/)
    expect("liveHandoffUrl" in structured!).toBe(false)
    expect(JSON.stringify(structured)).not.toMatch(/join=/)
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

  it("export_templates: ok, message, pages, paper, rows, cols, and the full state", async () => {
    const { text, structured } = await call("export_templates", { paperSize: "A4" })
    const state = describeState()
    expect(structured!.message).toMatch(/^PDF downloaded/)
    expect(structured).toMatchObject({ ok: true, pages: 3, paper: "A4", rows: 1, cols: 2, state })
    // paperSize is design state: the text is message + snapshot like any mutation
    expect(text).toBe(`${structured!.message}\n${JSON.stringify(state)}`)
    expect(state.paperSize).toBe("A4")
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
    const result = await tool("update_design").execute({ heightMm: 100 }, { signal: controller.signal })
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
      ["update_design", { heightMm: 140 }],
    ] as const) {
      const { text, structured } = await call(name, input)
      const textBytes = bytes(text)
      const structuredBytes = bytes(JSON.stringify(structured))
      const stateCompact = bytes(JSON.stringify(structured!.state))
      rows.push(
        `${name}: text ${textBytes} B (compact JSON) | structuredContent ${structuredBytes} B ` +
          `| state alone ${stateCompact} B | envelope total ${textBytes + structuredBytes} B`
      )
      expect(structuredBytes).toBeGreaterThan(0)
      // docs/webmcp-tool-performance-spec.md §13: the describe_project envelope stays under 1,200 B
      expect(textBytes + structuredBytes).toBeLessThan(1_200)
    }
    console.info(`[${TOOL_RESULT_CONTRACT} payload]\n  ${rows.join("\n  ")}`)
  })
})
