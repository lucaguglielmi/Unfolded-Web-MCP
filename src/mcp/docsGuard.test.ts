import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { TOOL_SUMMARIES } from "./tools"

/**
 * Documentation quality gate (docs/live-handoff-link-spec.md §10.8): the
 * public copy must describe the two-link model the code implements and
 * never drift back to the claims it replaced. README can't import, so its
 * tool table is checked against TOOL_SUMMARIES here; /webmcp renders the
 * list directly.
 */

const root = new URL("../../", import.meta.url)
const read = (path: string) => readFileSync(new URL(path, root), "utf8")

const AGENT_FACING_COPY = [
  "README.md",
  "docs/user-flow.md",
  "src/pages/WebMCPPage.tsx",
  "src/pages/WhyPage.tsx",
  "src/pages/agentManifest.ts",
  "src/components/PairDialog.tsx",
  "src/components/ConnectionHub.tsx",
  "src/components/ClipboardJoinBanner.tsx",
]

/** wording the spec retired — each must name the specific link type now */
const RETIRED_PHRASES = [
  "every link the agent hands you is a live one",
  "every link it hands you",
  "every link your agent hands you",
  "no url is ever a live capability",
  "connected via chatgpt",
  "thirteen tools",
]

/** the retired agent-facing field name, checked where prose lives (the
    dialogs legitimately import the shareUrl() builder) */
const PROSE_ONLY = ["README.md", "docs/user-flow.md", "src/pages/WebMCPPage.tsx", "src/pages/WhyPage.tsx", "src/pages/agentManifest.ts"]

describe("docs guard", () => {
  it("README's tool table matches TOOL_SUMMARIES name-for-name, in order", () => {
    const readme = read("README.md")
    const table = readme.slice(readme.indexOf("| Tool | What it does |"))
    const names = [...table.matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1])
    expect(names).toEqual(TOOL_SUMMARIES.map((t) => t.name))
  })

  it("the handoff tool and both link types are documented", () => {
    const readme = read("README.md")
    for (const term of ["create_live_handoff", "designUrl", "liveHandoffUrl"]) {
      expect(readme, `README must mention ${term}`).toContain(term)
    }
    expect(read("src/pages/WebMCPPage.tsx")).toContain("create_live_handoff")
  })

  it("retired claims stay retired", () => {
    for (const file of AGENT_FACING_COPY) {
      const text = read(file).toLowerCase()
      for (const phrase of RETIRED_PHRASES) {
        expect(text.includes(phrase), `${file} still says "${phrase}"`).toBe(false)
      }
    }
    for (const file of PROSE_ONLY) {
      expect(read(file).toLowerCase().includes("shareurl"), `${file} still says "shareUrl"`).toBe(false)
    }
  })

  it("the README stays a fast overview", () => {
    const words = read("README.md").split(/\s+/).filter(Boolean).length
    // docs/live-handoff-link-spec.md §10.2 asks for a ~1,200-word README
    // excluding commands and the tool table; the rewrite landed at ~1,400
    // prose words (~1,700 whole-file, which is what this counts), so this
    // ceiling holds the line against regrowth
    expect(words).toBeLessThanOrEqual(1_800)
  })
})
