import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const root = new URL("../", import.meta.url)
const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8")) as { version: string }
const template = readFileSync(new URL("page.template.html", root), "utf8")
const page = readFileSync(new URL("index.html", root), "utf8")

describe("profiler guide", () => {
  it("derives the public guide version from package metadata", () => {
    expect(template).toContain("__WEBMCP_PROFILER_VERSION__")
    expect(page).toContain(`v${pkg.version}`)
    expect(page).toContain(`webmcp-profiler@${pkg.version}`)
    expect(page).not.toContain("0.1.1")
  })
})
