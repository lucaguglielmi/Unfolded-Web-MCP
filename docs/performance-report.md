# Performance report

App-wide performance audit of tryunfolded.com at commit `364e8f2`+,
covering both the WebMCP tool surface and everything that is *not*
agent-facing: boot, rendering, interaction, PDF export, and memory.

## Methodology

Two instruments — the first lives in this repo, the second was a
one-off script:

- **[webmcp-profiler](../packages/webmcp-profiler)** — the performance
  analyser born *inside this project*: when agent interactions felt slow
  and the tool harness was the suspect, we built the profiler to find out,
  and it proved the harness innocent (0.2 ms floor) while catching the
  real cost, a 130 KB image payload. It is now published as
  [`webmcp-profiler` on npm](https://www.npmjs.com/package/webmcp-profiler)
  for any WebMCP site to use. Its agentless bench is `npm run perf`:
  real Chromium drives every tool through `document.modelContext` exactly
  as a host would and reports percentiles and payload sizes.
- **Playwright + CDP** against the production bundle (`vite preview`),
  run twice: desktop viewport at native speed, and a 390 px viewport at
  **4× CPU throttling** to stand in for a mid-range phone. Paint metrics
  come from the browser's own `PerformanceObserver`. That audit script
  is not committed — the numbers in §2–§5 are a snapshot taken at
  `364e8f2`, not a bench that re-runs in CI.

Caveat: pages load from localhost, so network transfer time is excluded —
bundle sizes are reported separately so network cost can be estimated per
connection.

## 1 · WebMCP tool surface (the profiler's domain)

| metric | value |
| --- | --- |
| tool execution, read tools | 0.2 ms p50 (`describe_project` — the full harness floor) |
| tool execution, mutations | 3–6 ms p50, ≤ 11 ms p95 |
| worst single observation | 46 ms once (`update_form` round↔faceted flip: three.js material recompile) |
| preview image payload | ~7 KB JPEG (~1.7 K tokens) — was 130 KB PNG before the profiler flagged it |
| text result payload | ~800 B (~200 tokens) |
| **discovery metadata** | **9,128 chars (~2,280 tokens) — trimmed 19.6% from 11,360 this pass** (13 tools at the time; 14-tool figure below) |

The metadata trim is the spec §9.1 pair, done in the safe order: the
**standard prompt suite** landed first (`src/mcp/promptSuite.test.ts` —
15 representative potter prompts mapped to the tool that should handle
them, asserting the discriminating phrases survive in that tool's
metadata), then descriptions were cut where they duplicated their own
input schemas. The suite caught two over-trims during the work (the
export tool lost "100% scale"; `start_pairing` lost its full-state
promise) — both restored. The remaining distance to the spec's 25%
aspiration would mean cutting contract sentences the suite protects;
stopping at 19.6% is deliberate. Also stripped: the content-free
`"$schema"` identifier zod emits per tool.

*Update:* the fourteenth tool, `create_live_handoff`, plus the
one-sentence link rule it adds to every editing tool
(docs/live-handoff-link-spec.md), raised the metadata on purpose to
**10,474 chars (~2,620 tokens)** — still 7.8% under the pre-trim 13-tool
baseline. The budget test moved with it, from 9,800 to 11,000 chars, so
it keeps catching quiet regrowth without failing the deliberate one.

*Update, after the native-host measurement (§1.2):* the schema-weight
trim. Property descriptions that restated their own JSON-schema bounds
and enums, and tool descriptions that restated their schemas, were cut;
every phrase the prompt suite protects survived unchanged. Discovery
metadata is now **9,029 chars (~2,260 tokens)**, down 13.8% from 10,474,
and the budget test follows it down to 9,500. `update_form`, the
heaviest descriptor, went from 2,114 to 1,652 bytes; what remains there
is the seven properties' types and bounds, which are the accuracy.

**Verdict: the tool harness is not slow.** Every page-side number is two
to three orders of magnitude below one model round trip. The recurring
costs an agent conversation actually pays are metadata (~2.3 K tokens
once per conversation, now 560 tokens cheaper) and per-result payloads
(minimal).

### 1.1 · Bench at webmcp-profiler 0.2.0 (`npm run perf -- --overhead`)

Sandbox Chromium, production bundle via `vite preview`, 40 runs per case
(15 for the image), driven by the package's own bench through its fake
host (`e2e/perf.cases.json`). The two right-hand columns are the
profiler's own cost: the same cases run a second time with `?perf=1`
unarmed, and the delta of p50 and p95 is printed. Every delta is within
run-to-run noise, which is what one serialization per call buys
(docs/webmcp-profiler-0.2-spec.md §7.2, §16.7).

```
tool                      runs   min     p50     p95     max     result-bytes  schema-bytes   Δp50 (profiler)   Δp95
describe_project            40     0.1     0.5     1.3     2.5         1480          938       0.30ms          0.30ms
get_template_summary        40     0.1     0.3     1.0     1.7         1486          453       0.10ms          0.10ms
update_form                 40     2.7     3.9     6.5     9.4         1499         2114       0.20ms         -0.40ms
update_form (type flip)     40     0.7     3.6     6.1     6.4         1607         2114      -0.10ms          0.90ms
set_clay                    40     2.3     2.5     3.9     6.7         1627          862      -0.20ms         -0.20ms
set_capacity                40     2.5     3.0     4.2     4.3         1699          765       0.10ms         -0.20ms
set_units                   40     0.9     2.7     3.4     4.3         1649          722      -0.20ms         -1.90ms
apply_preset                40     2.8     3.3     5.6     8.5         1527          615       0.20ms          0.40ms
undo_last_change            40     2.9     3.7     5.9     6.1         1629          560       0.50ms          0.10ms
open_model                  40     2.5     2.8     4.2     6.3         1515          898       0.00ms         -0.30ms
get_preview_image           15     1.2     1.5     5.2     5.2         7378          462       0.20ms          0.60ms
```

The `schema-bytes` column is new in 0.2: the descriptor bytes the host
ships for that tool in every conversation (UTF-8, from
`ledger.tools[name].schemaBytes`). `update_form` carries the heaviest
schema on the surface (1,652 bytes after the trim above; 2,114 in this
table); the whole 15-tool surface is about 11 KB, the `get_perf_report`
tool included while profiling is armed. Byte columns
across this report are UTF-8 from 0.2 on (0.1 counted UTF-16 units;
the difference is nil for these ASCII payloads).

### 1.2 · Through a real host: Chrome 152 native WebMCP (`npm run live:native`)

The bench above talks to the page through the package's fake host, so it
measures the page's side only. `e2e/native-host.mjs` measures the other
side: Chrome for Testing 152 with `--enable-features=WebMCPTesting`
exposes a native `document.modelContext`, and its DevTools `WebMCP`
domain lets the script act as the agent host (`invokeTool` →
`toolResponded`). Production, sandbox Linux headless, 20 runs per tool.
"host" is the round trip as the host sees it; "page" is what the
profiler inside the page recorded for the same calls.

```
tool                    runs   host p50    host p95    page p50    page p95   host overhead p50
describe_project          20     282.8 ms    321.6 ms       0.7 ms      1.4 ms      282.1 ms
get_preview_image         20     284.2 ms    291.0 ms       5.4 ms      7.0 ms      278.8 ms
```

`get_perf_report` read back through the host: 272 ms for 3,161 bytes
(tools view). The ledger seen from the page: host on `document`, 15
tools, 12,571 schema bytes, package 0.2.2.

Reading: the page's compute is unchanged from the fake-host bench, and
Chrome's host path adds a flat ~280 ms per invocation in this build,
independent of the tool's own cost or result size. That fixed cost is
the browser's (invocation plumbing between the DevTools client, the
renderer and the page), not the site's, so the actionable lever for an
agent conversation is the number of round trips, not the per-call
compute. The number should be re-measured on each Chrome release; the
script prints it in one line.

### 1.3 · After the tool-performance spec (`docs/webmcp-tool-performance-spec.md`)

The spec's §4–§8 landed together. Same bench as §1.1 (sandbox
Chromium, production bundle, the package's fake host, 40 runs per case,
15 for the image):

```
tool                              runs   min     p50     p95     max     result-bytes  schema-bytes
describe_project                    40     0.1     0.4     1.3     2.1         1270         1431
get_template_summary                40     0.1     0.3     0.5     1.0         1262          423
update_design (height)              40     3.5     5.2     9.8    13.7         1293         2628
update_design (type flip)           40     0.9     5.2     8.1    10.8         1397         2628
update_design (clay)                40     2.1     2.4     4.7     5.3         1401         2628
update_design (capacity)            40     2.3     2.9     5.6     5.7         1491         2628
update_design (units)               40     0.8     3.5     7.6     9.8         1429         2628
update_design (form+clay+units)     40     2.8     3.3     4.8     5.9         1449         2628
apply_preset                        40     3.1     3.7     5.5     6.1         1309          540
undo_last_change                    40     2.5     2.9     4.4     4.7         1405          536
open_model                          40     2.1     2.3     4.0     4.1         1297          740
get_preview_image                   15     1.5     1.7     6.2     6.2         7378          438
```

What changed, and what it bought:

| | before | after |
| --- | --- | --- |
| tools registered (plus `get_perf_report` while armed) | 14 | **11** — `update_form`, `set_clay`, `set_units`, `set_capacity` merged into `update_design` (§4) |
| *"hexagonal planter, 13% shrinkage, in inches, 350 ml"* | 3–4 sequential calls | **1 call**, one undo step; the bench's combined case runs in 3.3 ms p50 |
| discovery metadata (the budget test's measure) | 9,029 chars | **8,912 chars** (~2,230 tokens); budget 9,350. `describe_project` grew by ~700 chars for the fresh-session offer (§6.2) and the merged tool weighs 2,559 against the four's 3,526 |
| `describe_project` envelope (text + `structuredContent`) | 1,438 B | **1,094 B** (−24%): compact text, `linkMode` / `liveHandoffTool` dropped, `session {paired, peers}` added — contract `tool-result/2` (§5) |
| `update_design` envelope | 1,499 B (`update_form`) | **1,110 B** |
| host discovery after a late injection | up to 3 s (1.5 s average), never while hidden | **≤ 500 ms while visible, ≤ 3 s while hidden**, no visibility event needed (§7); the e2e suite's hidden-tab case registers the full set in under 6 s from injection with no event at all |
| registration of the set | 14 sequential awaits | **one parallel set** — the unit test's 14-tool host at 20 ms per registration finishes in one delay |
| `/assets/*` in the browser | `max-age=0, must-revalidate` (every chunk revalidated on every load) | **`public, max-age=31556952, immutable`** via `public/_headers` (§8); the HTML entry still revalidates. Checked by `e2e/worker-smoke.mjs` and `e2e/live.mjs` |
| a fresh ChatGPT session | offered only the pairing code | the snapshot's `session.paired` is a fact, and `describe_project` tells the agent to offer the `create_live_handoff` link as "Open a paired browser session with this chat" first, the code second (§6.2) |

The per-call page compute is unchanged (mutations 2–5 ms p50 including
React's re-render and the lathe rebuild). Against the ~280 ms the native
host adds per invocation (§1.2) and the model's own turn, the round-trip
reductions are what the potter feels; the byte reductions are what the
model reads less of, on every call. Reads are 0.4 ms p50 with the new
`session` field: `liveSync.isPaired()` is a storage read, `peers()` a
number.

## 2 · Boot and load

| metric | desktop 1× | 4× CPU, 390 px |
| --- | --- | --- |
| first contentful paint | 64 ms | 80 ms |
| DOMContentLoaded | 94 ms | 247 ms |
| **WebMCP tools registered** | **150 ms** | **468 ms** |
| 3D canvas mounted (lazy chunk) | 469 ms | 928 ms |
| largest contentful paint | 64 ms | 2.0 s (the rendered pot) |
| JS heap after load | 11 MB | 12 MB |

Bundle inventory (gzip): shell **142 KB** (this is what gates
time-to-tools), CSS 11 KB, then two deliberately lazy chunks — PDF
pipeline 158 KB (first export only) and the 3D stack 251 KB. The shell
paints and registers tools long before the 3D chunk arrives; a browser
with no GPU never downloads GPU code.

*Repeat visits:* until the tool-performance spec §8 landed, every file
under `/assets/` was served with `Cache-Control: public, max-age=0,
must-revalidate` (the Workers static-assets default), so a return visit —
and every fresh tab ChatGPT's agent browser opens — revalidated the shell,
the store chunk, the 3D chunk and the PDF chunk with the edge before
using them. `public/_headers` now marks `/assets/*` immutable for a year
(the names are content hashes); only the HTML entry revalidates.

Reading: the app shell is fast even throttled — an agent in a fresh
ChatGPT tab has all 14 tools well under half a second of CPU time (the
run measured 13; the fourteenth adds ~1 KB of metadata, no code path). The
2 s LCP on the throttled run is the pot itself appearing, which is the
inherent price of a real-time 3D preview arriving lazily; the page is
interactive (sliders, templates, tools) long before.

## 3 · Interaction

| metric | desktop 1× | 4× CPU |
| --- | --- | --- |
| slider-drag burst, per update (store → validation → React → three.js lathe rebuild) | 5.2 ms | **22.1 ms** |
| undo | 6 ms | 35 ms |

**The one real hotspot found:** at 4× throttle each drag update costs
22 ms — past the 16.7 ms frame budget, so a fast slider drag on a
mid-range phone renders at roughly 30–45 fps instead of 60. The cost is
the full value chain per step, dominated by rebuilding the lathe
geometry every update. `Viewport.tsx` has carried a comment saying
exactly this memo is the place to throttle *if a measurement ever says
so* — this is that measurement, with the qualifier that 30–45 fps during
an active drag is degraded, not broken, and invisible on desktop.

Recommended shape of a fix, when wanted (not shipped — it touches the
feel of the main interaction): throttle geometry
rebuilds to animation frames (`requestAnimationFrame`-coalesced) during
drags, letting the final release value always render. Everything else in
the interaction path is healthy.

## 4 · PDF export

| metric | desktop 1× | 4× CPU |
| --- | --- | --- |
| first export (includes lazy-loading the 158 KB-gzip PDF chunk) | 955 ms | 1.17 s |
| subsequent exports | 601 ms | 604 ms |

Sub-second on desktop including the one-time chunk load; the throttled
first export at ~1.2 s is dominated by chunk parse. Fine for an action
that ends in a file download, and the second-export numbers show the
generation itself is ~600 ms regardless of CPU class (it's dominated by
vector serialization, not layout math).

## 5 · Memory

11–12 MB JS heap with the full 3D scene resident — modest; no leak
pressure observed across the burst tests. The WebGL context-loss
recovery added earlier (remount on reclaim) also bounds worst-case GPU
memory behavior on mobile Safari.

## 6 · Findings ranked

1. **Fixed this pass**: discovery metadata −19.6% (11,360 → 9,128 chars),
   guarded by the new prompt suite + a metadata budget test that fails
   any future quiet regrowth (9,800 chars then; 11,000 since the
   fourteenth tool — see §1).
2. **Known, measured, deliberately deferred**: drag updates at 22 ms on
   throttled CPU (30–45 fps drags on mid-range phones). Fix shape
   documented above; risk/benefit says after public launch.
3. **Healthy, no action**: boot, time-to-tools, undo, PDF export, memory,
   payload sizes, and the tool harness itself (0.2 ms floor).
4. **Structural wins already in place**: PDF and 3D stacks are lazy
   chunks; no GPU work is preloaded on browsers that can't use it; the
   preview payload is 19× lighter than its first version.

## 7 · Structured results — contract `tool-result/2`

Done additively. Every tool result keeps its
MCP-style `content` array and `isError` flag byte-for-byte — the envelope
ChatGPT's agent browser is verified against — and gains a
`structuredContent` object beside it. The WebMCP draft itself defines no
result envelope: its IDL is `callback ToolExecuteCallback = Promise<any>
(object inputObject, ToolExecuteCallbackOptions options)` and the "tool
execute steps" hand the host the fulfilled value after "serializing a
JavaScript value to a JSON string". So the field name follows the MCP
convention (`structuredContent` next to `content`), which is also what
MCP-B's published types expose; a host that ignores the field loses
nothing, and one that prefers structured data has it without parsing text.

The contract, versioned `tool-result/2` (`TOOL_RESULT_CONTRACT` in
`src/mcp/modelContext.ts`; `/1` differed only in the text half being
pretty-printed and the snapshot carrying two constant fields,
`linkMode` and `liveHandoffTool`, retired by the tool-performance spec
§5 — `session {paired, peers}` arrived in the same bump):

| tool(s) | `structuredContent` |
| --- | --- |
| describe_project, open_model, update_design, apply_preset, join_session, start_pairing, undo_last_change | `{ ok, message, state, warnings? }` — `state` is the same `describeState()` snapshot the text serializes (compact JSON in both from `/2` on: form, clay, paperSize, units, designUrl, capacityMl, pieces, printedPages, warnings, session); `warnings` only when the design has any |
| any of the above on failure (validation, failed join, nothing to undo, no pairing service) | `{ ok: false, message, state }` — the unchanged state |
| create_live_handoff | the handoff object (`liveHandoffUrl`, `designUrl`, `expiresAt`, `expiresInSeconds`, `singleUse`, `instruction`) plus `ok`/`message`; fail-closed: `{ ok: false, message, state }` with no URL field |
| get_template_summary | the template summary object plus `ok`/`message` |
| get_preview_image | image content unchanged; `{ ok, message, summary }` |
| export_templates | `{ ok, message, pages, paper, rows, cols, state, warnings? }` — the export's own numbers plus the same `state` snapshot as the mutations (paper size is design state, and the text carries the same pretty-printed JSON after the message) |
| host cancellation (any tool) | `{ ok: false, message }` |

Invariants a host can rely on, pinned by `src/mcp/structuredResult.test.ts`
for every tool and by an e2e check on a read and a mutation: `ok` mirrors
`!isError`; when `state` is present it deep-equals the JSON in the text;
tool names, descriptions, schemas, and annotations are untouched (the
discovery-metadata budget test is unchanged and green).

Payload bytes (classic-mug design, measured by the test's last case):

| tool | contract | text content | `structuredContent` | `state` alone | envelope total |
| --- | --- | --- | --- | --- | --- |
| describe_project | `/1` (pretty text) | 673 B | 603 B | 555 B | 1,276 B |
| update_form | `/1` (pretty text) | 687 B | 601 B | 555 B | 1,288 B |
| describe_project | `/2` (compact) | 523 B | 571 B | 523 B | **1,094 B** |
| update_design | `/2` (compact) | 539 B | 571 B | 523 B | **1,110 B** |

Reading: under `/1` carrying both halves roughly doubled a ~700 B result
to ~1.3 KB; `/2` compacts the text and drops the constants, so both
halves are now the same ~520 B object and the envelope is ~1.1 KB — about
270 tokens per call on a host that serializes the whole result, still an
order of magnitude under the 7 KB preview image. When the text half is
retired (after structured results are verified in ChatGPT and Chrome —
the post-launch review in docs/webmcp-tool-performance-spec.md §9),
results halve again. Until then the duplication is the price of not
touching the one path known to work.
