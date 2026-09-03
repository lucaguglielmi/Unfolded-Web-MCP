import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { describe, expect, it } from "vitest"

const pkg = new URL("../", import.meta.url).pathname
const repo = new URL("../../../", import.meta.url).pathname
const read = (p: string) => readFileSync(p, "utf8")

describe("README", () => {
  it("every ts snippet compiles against the package", () => {
    execFileSync("node", ["scripts/extract-snippets.mjs"], { cwd: pkg, stdio: "pipe" })
    expect(readdirSync(`${pkg}src/__snippets__`).length).toBeGreaterThan(3)
    let output = ""
    try {
      output = execFileSync("npx", ["tsc", "-p", "tsconfig.snippets.json"], { cwd: pkg, stdio: "pipe" }).toString()
    } catch (error) {
      output = String((error as { stdout?: Buffer }).stdout ?? error)
      expect.fail(`README snippets do not compile:\n${output}`)
    }
    expect(output.trim()).toBe("")
  }, 60_000)

  it("keeps the section order of the 0.2 spec §10.1", () => {
    const headings = [...read(`${pkg}README.md`).matchAll(/^## (.+)$/gm)].map((m) => m[1])
    const expected = [
      "Why",
      "See it in ten seconds, nothing installed",
      "Install",
      "Quickstart, three ways",
      "Console API",
      "Configuration",
      "See it work in two minutes",
      "Let your agent read it",
      "What a span records",
      "The overlay and the relay",
      "The report",
      "Build your own exporter",
      "Bench and compare, without an agent",
      "Privacy and security",
      "Using it with Vite",
      "Host support",
      "Overhead",
      "Troubleshooting",
      "Upgrading from 0.1",
      "Stability",
      "Case study: Unfolded",
      "Terms",
    ]
    expect(headings).toEqual(expected)
  })

  it("retired claims stay retired across the agent-facing copy", () => {
    const retired = [
      "renders spans recorded in a hidden agent tab live",
      "everything stays in your tab",
      "then read the report.",
      "read it back with `window.__webmcpperf.report()`",
    ]
    const files = [
      `${pkg}README.md`,
      `${repo}README.md`,
      `${repo}src/pages/WebMCPPage.tsx`,
      `${repo}src/pages/agentManifest.ts`,
    ].filter(existsSync)
    for (const file of files) {
      const text = read(file).toLowerCase()
      for (const phrase of retired) expect(text.includes(phrase), `${file} still says "${phrase}"`).toBe(false)
    }
  })

  it("the docs index lists every document in docs/", () => {
    const index = read(`${repo}docs/README.md`)
    for (const name of readdirSync(`${repo}docs`)) {
      if (name === "README.md") continue
      expect(index.includes(name), `docs/README.md has no row for ${name}`).toBe(true)
    }
  })

  it("llms.txt is shipped and current", () => {
    expect(pkg && existsSync(`${pkg}llms.txt`)).toBe(true)
    expect(read(`${pkg}llms.txt`)).toContain("## Console API")
  })
})
