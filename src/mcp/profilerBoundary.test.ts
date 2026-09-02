import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * The app reaches the profiler only through its public entries
 * (docs/webmcp-profiler-0.2-spec.md §2.1 item 4), so the day the package
 * moves to its own repository the alias becomes the npm name with no
 * other change.
 */
const ALLOWED = new Set(["@/profiler/index", "@/profiler/attach", "@/profiler/tool", "@/profiler/testing", "@/profiler/docs"])
const root = new URL("../../", import.meta.url).pathname
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx|mjs)$/.test(name) ? [path] : []
  })

describe("profiler boundary", () => {
  it("imports only the package's public entries", () => {
    const offenders: string[] = []
    for (const file of [...walk(join(root, "src")), ...walk(join(root, "e2e"))]) {
      for (const m of readFileSync(file, "utf8").matchAll(/from "(@\/profiler\/[^"]+)"/g)) {
        if (!ALLOWED.has(m[1])) offenders.push(`${file.replace(root, "")}: ${m[1]}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
