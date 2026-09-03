#!/usr/bin/env node
// Refuse to publish from a dirty tree or without a CHANGELOG heading for
// this version (current profiler spec §13).
import { execSync } from "node:child_process"
import { readFileSync } from "node:fs"

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8")
if (!changelog.includes(`## [${pkg.version}]`)) {
  console.error(`prepublish: CHANGELOG.md has no "## [${pkg.version}]" heading`)
  process.exit(1)
}
if (process.env.WEBMCP_PROFILER_ALLOW_DIRTY !== "1") {
  const status = execSync("git status --porcelain -- .", { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8" }).trim()
  if (status) {
    console.error("prepublish: working tree is dirty under packages/webmcp-profiler:\n" + status)
    process.exit(1)
  }
}
console.log(`prepublish: ${pkg.name}@${pkg.version} ok`)
