import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The two-link contract (docs/live-handoff-link-spec.md §11.1): state
 * reads are pure and carry only the permanent designUrl; the live
 * liveHandoffUrl exists only as the output of create_live_handoff, which
 * mints on demand and fails closed.
 */

const { mintToken } = vi.hoisted(() => ({
  mintToken: vi.fn<() => Promise<{ token: string; expiresAt: number } | null>>(),
}))

vi.mock("@/store/syncClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/store/syncClient")>()
  return { ...actual, liveSync: { ...actual.liveSync, mintToken } }
})

const { buildTools } = await import("./tools")
const { describeState } = await import("./describe")
const { createLiveHandoff } = await import("./liveHandoff")
const { useProjectStore } = await import("@/store/useProjectStore")

const tool = (name: string) => buildTools().find((t) => t.name === name)!
const textOf = async (name: string, input: unknown = {}) => {
  const result = await tool(name).execute(input)
  return { isError: result.isError === true, text: result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n") }
}

let tokenCounter = 0
beforeEach(() => {
  tokenCounter = 0
  mintToken.mockReset()
  mintToken.mockImplementation(async () => ({
    token: `tok_${++tokenCounter}_${"x".repeat(24)}`,
    expiresAt: Date.now() + 10 * 60_000,
  }))
  useProjectStore.getState().applyPreset("classic-mug")
})

describe("designUrl — the permanent link", () => {
  it("never carries a join token or agent tag, whatever the agent status", () => {
    useProjectStore.setState({ agentStatus: "native" })
    const { designUrl, session } = describeState()
    expect(designUrl).not.toContain("join=")
    expect(designUrl).not.toContain("via=")
    expect(designUrl).toContain("type=")
    // the snapshot reports the session as a fact: this test tab is unpaired and alone
    expect(session).toEqual({ paired: false, peers: 1 })
  })

  it("is the only link in state snapshots — no shareUrl remains", () => {
    expect("shareUrl" in describeState()).toBe(false)
  })
})

describe("create_live_handoff", () => {
  it("returns liveHandoffUrl with via=chatgpt and a join token, plus the design", async () => {
    useProjectStore.getState().updateForm({ heightMm: 123 })
    const { isError, text } = await textOf("create_live_handoff")
    expect(isError).toBe(false)
    const result = JSON.parse(text) as Record<string, unknown>
    expect(Object.keys(result).sort()).toEqual(
      ["designUrl", "expiresAt", "expiresInSeconds", "instruction", "liveHandoffUrl", "singleUse"].sort()
    )
    const live = result.liveHandoffUrl as string
    expect(live).toContain("via=chatgpt")
    expect(live).toMatch(/join=tok_1_/)
    expect(live).toContain("height=123")
    expect(result.designUrl as string).not.toContain("join=")
    expect(result.designUrl as string).toContain("height=123")
    expect(result.singleUse).toBe(true)
    expect(result.expiresInSeconds).toBeGreaterThan(590)
    expect(result.instruction).toContain("verbatim")
  })

  it("awaits the mint — a slow pairing service still yields a tokened link", async () => {
    let release!: (v: { token: string; expiresAt: number }) => void
    mintToken.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)))
    const pending = createLiveHandoff()
    release({ token: "late_token_1234567890abcdef", expiresAt: Date.now() + 60_000 })
    const handoff = await pending
    expect(handoff?.liveHandoffUrl).toContain("join=late_token_1234567890abcdef")
  })

  it("fails closed: no URL of any kind when the mint fails", async () => {
    mintToken.mockResolvedValue(null)
    const { isError, text } = await textOf("create_live_handoff")
    expect(isError).toBe(true)
    expect(text).toMatch(/could not be created/)
    expect(text).not.toMatch(/https?:\/\//)
    expect(text).not.toContain("?type=")
    expect(text).toContain("start_pairing")
  })

  it("absorbs a cold first mint: the socket that comes up late still yields a link", async () => {
    // the first mint spent its whole budget opening the session socket
    mintToken.mockResolvedValueOnce(null)
    const handoff = await createLiveHandoff()
    expect(handoff?.liveHandoffUrl).toMatch(/join=tok_/)
    expect(mintToken).toHaveBeenCalledTimes(2)
  })

  it("gives up after the retry — no endless minting on a real outage", async () => {
    mintToken.mockResolvedValue(null)
    expect(await createLiveHandoff()).toBeNull()
    expect(mintToken).toHaveBeenCalledTimes(2)
  })

  it("treats an already-expired token as a failure", async () => {
    mintToken.mockResolvedValue({ token: "stale_token_1234567890abcd", expiresAt: Date.now() - 1 })
    expect(await createLiveHandoff()).toBeNull()
  })

  it("mints a distinct token per call", async () => {
    const a = JSON.parse((await textOf("create_live_handoff")).text) as { liveHandoffUrl: string }
    const b = JSON.parse((await textOf("create_live_handoff")).text) as { liveHandoffUrl: string }
    expect(a.liveHandoffUrl).not.toBe(b.liveHandoffUrl)
    expect(mintToken).toHaveBeenCalledTimes(2)
  })

  it("is not annotated read-only — it creates a capability", () => {
    expect(tool("create_live_handoff").annotations?.readOnlyHint).toBeUndefined()
  })

  it("honors a host cancellation that lands after the mint", async () => {
    const controller = new AbortController()
    mintToken.mockImplementationOnce(async () => {
      controller.abort()
      return { token: "cancelled_token_1234567890", expiresAt: Date.now() + 60_000 }
    })
    const result = await tool("create_live_handoff").execute({}, { signal: controller.signal })
    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("Cancelled") })
  })
})

describe("no other tool spends a token", () => {
  it("describe_project and every mutation leave mintToken untouched", async () => {
    useProjectStore.setState({ agentStatus: "native" })
    await textOf("describe_project")
    await textOf("update_design", { heightMm: 140, shrinkagePct: 11, units: "in" })
    await textOf("update_design", { capacityMl: 300 })
    await textOf("apply_preset", { preset: "tumbler" })
    await textOf("open_model", { url: "?type=hexagon&height=150" })
    await textOf("undo_last_change")
    await textOf("get_template_summary")
    expect(mintToken).not.toHaveBeenCalled()
  })
})
