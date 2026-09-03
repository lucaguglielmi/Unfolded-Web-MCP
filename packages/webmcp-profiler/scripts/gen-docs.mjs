#!/usr/bin/env node
// Projects the typed documentation source (dist/index.js: SPAN_FIELDS,
// LEDGER_FIELDS, METHOD_DOCS, CONFIG_DOCS, PHASE_HINTS, describe) into
// the README's generated blocks and llms.txt. `--check` fails when the
// files on disk differ from what would be generated. Needs a build.
import { readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"

const root = new URL("../", import.meta.url)
const mod = await import(new URL("dist/docs.js", root).href)
const { PACKAGE_VERSION, REPORT_FORMAT } = await import(new URL("dist/index.js", root).href)
const { SPAN_FIELDS, LEDGER_FIELDS, METHOD_DOCS, CONFIG_DOCS, PHASE_HINTS, REPORT_VIEWS, PRIVACY, describe } = mod
const check = process.argv.includes("--check")

const table = (headers, rows) => [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n")
const code = (s) => `\`${String(s).replaceAll("|", "\\|")}\``

const blocks = {
  api: table(
    ["member", "what it does"],
    Object.entries(METHOD_DOCS).map(([k, v]) => [code(k === "active" || k === "sessionId" ? k : `${k}()`), v])
  ),
  config: table(
    ["key", "default", "what it does"],
    Object.entries(CONFIG_DOCS).map(([k, v]) => [code(k), code(v.default), v.doc])
  ),
  span: table(
    ["field", "meaning"],
    Object.entries(SPAN_FIELDS).map(([k, v]) => [code(k), v.replaceAll("`", "'")])
  ),
  ledger: table(
    ["field", "meaning"],
    Object.entries(LEDGER_FIELDS).map(([k, v]) => [code(k), v])
  ),
  views: table(
    ["view", "returns"],
    Object.entries(REPORT_VIEWS).map(([k, v]) => [code(k), v])
  ),
  troubleshooting: Object.entries(PHASE_HINTS)
    .filter(([phase]) => phase !== "inactive" && phase !== "detached")
    .map(([phase, { message, hints }]) => `**\`${phase}\`** — ${message}.\n${hints.map((h) => `- ${h}`).join("\n")}`)
    .join("\n\n"),
  privacy: PRIVACY.map((p) => `- ${p}`).join("\n"),
  sri: (() => {
    const iife = readFileSync(new URL("dist/webmcp-profiler.iife.js", root))
    const hash = createHash("sha384").update(iife).digest("base64")
    return [
      "```html",
      `<script src="https://cdn.jsdelivr.net/npm/webmcp-profiler@${PACKAGE_VERSION}/dist/webmcp-profiler.iife.js"`,
      `        integrity="sha384-${hash}" crossorigin="anonymous"></script>`,
      "```",
    ].join("\n")
  })(),
}

const apply = (text) => {
  let out = text
  for (const [name, body] of Object.entries(blocks)) {
    const re = new RegExp(`(<!-- gen:${name} -->)[\\s\\S]*?(<!-- /gen:${name} -->)`)
    if (!re.test(out)) throw new Error(`README has no <!-- gen:${name} --> block`)
    out = out.replace(re, `$1\n${body}\n$2`)
  }
  return out
}

const llms = () => {
  const m = describe({}, "get_perf_report")
  const lines = [
    `# webmcp-profiler ${PACKAGE_VERSION} — reference for agents`,
    "",
    "Drop-in performance analyser for WebMCP tool surfaces. Measures every registered tool's execute():",
    "wall time, Long-Task blocking, payload bytes and estimated tokens, error rate, schema weight, and the",
    "host + model gaps between calls. Zero dependencies. ESM, browser runtime.",
    "",
    "## Install and use",
    "",
    "    npm install webmcp-profiler",
    '    import { maybeAttachProfiler } from "webmcp-profiler/attach"   // first line at boot',
    "    maybeAttachProfiler()                                         // opens on ?perf=1",
    '    import { attachProfiler } from "webmcp-profiler"               // or unconditionally',
    "    const profiler = attachProfiler({ onSpan: (span) => console.log(span) })",
    '    import { profilerTool } from "webmcp-profiler/tool"            // let agents read the report',
    "    document.modelContext.registerTool(profilerTool(profiler))",
    '    import { createFakeHost } from "webmcp-profiler/testing"       // no agent host? drive tools yourself',
    "    npx webmcp-profiler bench <url>                                // agentless CI bench",
    "",
    "## Activation (query parameter, persisted per origin)",
    "",
    ...Object.entries(m.activation.modes).map(([k, v]) => `- ?${m.activation.param}=${k}: ${v}`),
    `- storage key: ${m.activation.storageKey}`,
    `- cost: ${m.activation.cost}`,
    "",
    `## Console API (window.${m.console.global})`,
    "",
    ...Object.entries(m.console.methods).map(([k, v]) => `- ${k}: ${v}`),
    "",
    "## Configuration (attachProfiler and the gate)",
    "",
    ...Object.entries(m.config).map(([k, v]) => `- ${k} (default ${v.default}): ${v.doc}`),
    "",
    "## Span fields",
    "",
    ...Object.entries(m.span).map(([k, v]) => `- ${k}: ${v}`),
    "",
    "## Ledger fields",
    "",
    ...Object.entries(m.ledger).map(([k, v]) => `- ${k}: ${v}`),
    "",
    `## Report tool (${m.tool.name}) views`,
    "",
    ...Object.entries(m.tool.views).map(([k, v]) => `- ${k}: ${v}`),
    "",
    `## Report format: ${REPORT_FORMAT} (schema: schema/report.v2.json)`,
    "",
    "## Privacy",
    "",
    ...m.privacy.map((p) => `- ${p}`),
    "",
    "Full README: https://www.npmjs.com/package/webmcp-profiler",
    "",
  ]
  return lines.join("\n")
}

const targets = [
  { path: new URL("README.md", root), next: (t) => apply(t) },
  { path: new URL("llms.txt", root), next: () => llms() },
]
let stale = false
for (const { path, next } of targets) {
  let current = ""
  try {
    current = readFileSync(path, "utf8")
  } catch {
    current = ""
  }
  const generated = next(current)
  if (generated === current) continue
  if (check) {
    console.error(`docs: ${path.pathname} is stale; run npm run docs`)
    stale = true
  } else {
    writeFileSync(path, generated)
    console.log(`docs: wrote ${path.pathname}`)
  }
}
process.exit(stale ? 1 : 0)
