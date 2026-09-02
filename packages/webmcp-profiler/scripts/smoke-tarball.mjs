// Runs inside a scratch project where the packed tarball was installed:
// imports every public subpath and exercises the pure API end to end.
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const core = await import("webmcp-profiler")
const attach = await import("webmcp-profiler/attach")
const lazy = await import("webmcp-profiler/attach-lazy")
const tool = await import("webmcp-profiler/tool")
const testing = await import("webmcp-profiler/testing")
const docs = await import("webmcp-profiler/docs")
const bench = await import("webmcp-profiler/bench")
const schema = JSON.parse(readFileSync(require.resolve("webmcp-profiler/schema/report.v2.json"), "utf8"))
const pkg = require("webmcp-profiler/package.json")

const assert = (cond, msg) => {
  if (!cond) {
    console.error("smoke: FAIL", msg)
    process.exit(1)
  }
}
assert(typeof core.attachProfiler === "function", "attachProfiler")
assert(typeof attach.maybeAttachProfiler === "function", "maybeAttachProfiler")
assert(typeof lazy.maybeAttachProfilerLazy === "function", "maybeAttachProfilerLazy")
assert(typeof tool.profilerTool === "function", "profilerTool")
assert(typeof testing.createFakeHost === "function" && testing.FAKE_HOST_INIT_SCRIPT.includes("__webmcpFakeHost"), "testing")
assert(typeof bench.runBench === "function", "bench")
assert(core.REPORT_FORMAT === "webmcp-perf-report/2" && schema.title === core.REPORT_FORMAT, "format")
assert(core.PACKAGE_VERSION === pkg.version, `version ${core.PACKAGE_VERSION} vs ${pkg.version}`)
const noop = core.attachProfiler() // no window here: the no-op
assert(noop.active === false && noop.report().format === core.REPORT_FORMAT, "ssr no-op")
const m = docs.describe({}, "get_perf_report")
assert(m.package.version === pkg.version && Object.keys(m.span).length > 10, "describe")
const base = noop.report()
const diff = core.compare(base, base, { p95Ms: 1 })
assert(diff.verdict === "pass", "compare")
assert(core.toTraceEvents(base).length === 0, "trace")
console.log(`smoke: webmcp-profiler@${pkg.version} ok`)
