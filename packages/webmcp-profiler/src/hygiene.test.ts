import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const src = new URL("./", import.meta.url).pathname
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === "__snippets__" ? [] : walk(path)
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [path] : []
  })
const files = walk(src)

describe("source hygiene", () => {
  it("has no repo-internal wording in shipped sources", () => {
    const forbidden = ["src/profiler", "roadmap", "this repo", "this app", "Unfolded", "tryunfolded"]
    for (const file of files) {
      const text = readFileSync(file, "utf8")
      for (const token of forbidden) expect(text.includes(token), `${file} mentions "${token}"`).toBe(false)
    }
  })

  it("documents every exported declaration with a doc comment", () => {
    const undocumented: string[] = []
    for (const file of files) {
      const lines = readFileSync(file, "utf8").split("\n")
      lines.forEach((line, i) => {
        if (!/^export (async function|function|const|let|class|interface|type|enum) [A-Za-z_$]/.test(line)) return
        let j = i - 1
        while (j >= 0 && lines[j].trim().startsWith("//")) j--
        const prev = lines[j]?.trim() ?? ""
        if (!prev.endsWith("*/")) undocumented.push(`${file.replace(src, "")}:${i + 1} ${line.slice(0, 60)}`)
      })
    }
    expect(undocumented).toEqual([])
  })
})
