import { existsSync, readFileSync, readdirSync } from "node:fs"
import { gzipSync } from "node:zlib"
import { describe, expect, it } from "vitest"

const root = new URL("../", import.meta.url)
const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"))

describe("package.json", () => {
  it("ships the license, changelog, and agent reference", () => {
    for (const f of ["LICENSE", "CHANGELOG.md", "llms.txt", "README.md", "dist", "bin", "schema"]) expect(pkg.files).toContain(f)
    expect(existsSync(new URL("LICENSE", root))).toBe(true)
    expect(readFileSync(new URL("LICENSE", root), "utf8")).toContain("MIT License")
    expect(readFileSync(new URL("CHANGELOG.md", root), "utf8")).toContain(`## [${pkg.version}]`)
  })

  it("names the IIFE as the only side effect and points CDNs at it", () => {
    expect(pkg.sideEffects).toEqual(["./dist/webmcp-profiler.iife.js"])
    expect(pkg.unpkg).toBe("./dist/webmcp-profiler.iife.js")
    expect(pkg.jsdelivr).toBe("./dist/webmcp-profiler.iife.js")
    expect(pkg.engines.node).toBe(">=20")
  })

  it("exports every subpath with types, import, and default conditions", () => {
    for (const [sub, target] of Object.entries(pkg.exports) as [string, Record<string, string> | string][]) {
      if (typeof target === "string") continue
      expect(target.types, sub).toMatch(/\.d\.ts$/)
      expect(target.default, sub).toBeDefined()
      if (sub !== "./iife") expect(target.import, sub).toBe(target.default)
    }
    expect(pkg.exports["./package.json"]).toBe("./package.json")
    expect(pkg.exports["./schema/report.v2.json"]).toBe("./schema/report.v2.json")
  })

  it("has no runtime dependencies and only optional peers", () => {
    expect(pkg.dependencies).toBeUndefined()
    for (const peer of Object.keys(pkg.peerDependencies ?? {})) expect(pkg.peerDependenciesMeta?.[peer]?.optional, peer).toBe(true)
  })

  it("stays under the gzip ceilings when a build is present", () => {
    const dist = new URL("dist/", root)
    if (!existsSync(dist)) return
    const files = readdirSync(dist).filter((f) => f.endsWith(".js"))
    const gz = (re: RegExp) => {
      const f = files.find((x) => re.test(x))
      return f ? gzipSync(readFileSync(new URL(f, dist))).length : 0
    }
    expect(gz(/^core-.*\.js$/)).toBeLessThanOrEqual(6 * 1024)
    expect(gz(/^attach\.js$/)).toBeLessThanOrEqual(1024)
    expect(gz(/^overlay-.*\.js$/)).toBeLessThanOrEqual(4 * 1024)
    expect(gz(/^webmcp-profiler\.iife\.js$/)).toBeLessThanOrEqual(14 * 1024)
  })
})
