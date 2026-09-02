# WebMCP Profiler — spec

A performance analyser for WebMCP tool surfaces: a small, dependency-free
library that any site can load to measure, grade, and export the real
performance of its `document.modelContext` tools — across hosts (Chrome
flag, ChatGPT's hidden browser, polyfills), across devices, and without
needing an agent in the loop.

Status: **design spec, partly built.** This document describes the whole
analyser as designed; the published package (`packages/webmcp-profiler`,
`webmcp-profiler` on npm) ships a subset of it. What exists today: the
interceptor, the in-memory ring-buffer collector with Long-Task blocking
attribution and DevTools `performance.measure` marks, the host-gap
ledger with percentiles, the console API (`table`, `report`, `export`,
`instrument`, `reset`, `detach`), the overlay, the BroadcastChannel relay,
and the ESM + IIFE builds; the config surface is `{ buffer, relay,
overlay }`. Not yet built: IndexedDB persistence, the WebSocket relay,
the beacon, the OTel exporter, budgets/grades, the anti-pattern
detectors, `captureBodies`, and the in-page synthetic bench (`.bench()`);
a hand-rolled v0 of the bench lives outside the package as `npm run perf`
(`e2e/perf.mjs`). Section headings below carry a *(shipped)* / *(not yet
built)* marker, and §12 is the single source of truth for what has landed.

## 1 · Why — where the time actually goes

Measured on this app (production bundle, real Chromium, 40 runs/tool):
every tool executes in **single-digit milliseconds** (p50 ≤ 5 ms, p95
≤ 13 ms; even `get_preview_image`, which captures and encodes a PNG, is
~5 ms). Yet agent interactions *feel* slow. So the latency lives in the
parts no `console.time` inside the page can see:

| segment | typical cost | owned by |
| --- | --- | --- |
| tool `execute()` — page compute | 1–15 ms | the site |
| result payload → model context | scales with bytes (ours: ~800 B text; the preview image was ~130 KB as a 480 px PNG, now ~7 KB as a 320 px JPEG) | both — the site chooses the size, the host pays the serialization, the model pays the tokens |
| host scheduling + bridge overhead | unknown — invisible from inside the page alone | the host |
| model round trip per tool call | seconds | the platform |
| tool registration after host injection | up to one poll heartbeat (this app: ≤ 3 s, once) | the site |
| network-backed tools (pairing, minting) | one server round trip | the site's backend |

The conclusion generalizes: **"the tools are slow" is usually three
different problems wearing one coat** — page compute, payload weight, and
host/model wait. A useful analyser must separate them, because the fixes
are completely different (optimize code / shrink payloads / batch calls
and cut round trips). That separation is this tool's whole reason to
exist; a stopwatch around `execute()` would mostly measure the innocent
segment.

## 2 · Goals and non-goals

Goals:

- Drop into **any** WebMCP project — one script tag or one import, no
  framework assumptions, no build-step requirement, no backend required.
- Measure every registered tool automatically: interception, not
  per-tool annotation.
- Attribute time to the right owner: page compute vs payload weight vs
  host gap.
- Work where the screen isn't: hidden agent browsers must be profilable
  from a visible tab.
- Produce both a live view (overlay) and durable artifacts (versioned
  JSON report, OpenTelemetry spans, DevTools marks).
- Benchmark without an agent: schema-driven synthetic calls give
  reproducible baselines in CI.

Non-goals:

- Not an APM suite: no server-side agent, no sampling of general page
  performance beyond what tool calls touch.
- Not a WebMCP polyfill or host; it observes whatever host is present.
- Never a data exfiltration path: payload *contents* stay in the page by
  default; only shapes, sizes, and timings leave it (§10).

## 3 · Architecture *(interceptor and collector shipped; the persistence, WebSocket, budgets, detectors, beacon and OTel boxes are not yet built)*

Four layers, separable so a project can load only what it needs:

```
┌────────────────────────────────────────────────────────┐
│ surfaces      overlay UI · console API · beacon ·      │
│               DevTools marks · OTel exporter           │
├────────────────────────────────────────────────────────┤
│ analysis      percentiles · budgets/grades ·           │
│               host-gap ledger · anti-pattern detectors │
├────────────────────────────────────────────────────────┤
│ collector     span store (ring buffer) · IndexedDB     │
│               persistence · BroadcastChannel/WS relay  │
├────────────────────────────────────────────────────────┤
│ interceptor   wraps registerTool + execute ·           │
│               host detection · registration timeline   │
└────────────────────────────────────────────────────────┘
```

### Interceptor *(shipped)*

The only mandatory layer. On load it patches the registration surface —
`document.modelContext.registerTool` / `provideContext`, and the
`navigator.modelContext` variant — so every tool a site registers is
wrapped transparently:

- **Early load** (before the app registers): pure pass-through wrapping.
- **Late load** (bookmarklet / DevTools snippet on a page that already
  registered): retrofits by re-registering wrapped copies where the host
  allows it, else falls back to wrapping the site's own registry if one
  is exposed (this app: `window.__unfoldedTools`).
- **No host present**: installs a *recording* stub `modelContext` so
  registration timing and tool surface are still captured, and flags the
  session `hostless` (useful in CI).

The wrapper adds one `try/finally` and two `performance.now()` calls of
overhead per invocation — budgeted at < 0.1 ms so the profiler never
becomes the thing it measures (§11).

### Collector *(shipped, in-memory only)*

A ring buffer of spans (default 500, configurable) in memory, with
opt-in persistence to IndexedDB keyed by origin + session id, so a
report can span reloads (the IndexedDB persistence is not yet built —
today a reload starts an empty buffer). Everything else consumes the collector; nothing
below it knows whether an overlay or a beacon exists.

## 4 · The span — what one tool call records *(shipped in part)*

```jsonc
{
  "spanId": "…", "sessionId": "…", "seq": 17,
  "tool": "update_form",
  "t": { "invoked": 81234.2, "settled": 81239.1 },     // performance.now()
  "wallMs": 4.9,                                        // execute() await
  "blockingMs": 3.1,        // Long-Task overlap attributed to this call
  "queueDelayMs": 0.4,      // host handoff → first line of execute
  "input":  { "bytes": 38,   "schemaValid": true },
  "result": {
    "bytes": 775, "isError": false,
    "contentTypes": { "text": 1 },
    "imageBytes": 0,
    "estTokens": 194        // bytes/4 heuristic — the model-side cost
  },
  "gapSincePrevCallMs": 8412,   // ← host+model think time, see §5
  "memoryDeltaBytes": 12288,     // where measureUserAgentSpecificMemory exists
  "frameDrops": 0,               // rAF-probe stalls during the call
  "error": null
}
```

Shipped fields: `seq`, `tool`, the `performance.now()` bracket
(`invokedAt`/`settledAt`), `wallMs`, `blockingMs`, input/result bytes,
`contentTypes`, `imageBytes`, `estTokens`, `isError`, `error`,
`gapSincePrevCallMs`, and a `synthetic` flag. Not yet built:
`queueDelayMs`, `schemaValid`, `memoryDeltaBytes`, `frameDrops`, and the
`spanId`/`sessionId` identifiers.

Sources: `performance.now()` bracketing; a `PerformanceObserver` on
`longtask` whose entries are attributed to any overlapping span
(`blockingMs`); a low-frequency `requestAnimationFrame` heartbeat for
`frameDrops`; `performance.measureUserAgentSpecificMemory()` when the
page is cross-origin isolated, JS heap via `performance.memory` as the
degraded fallback; JSON sizes measured on the already-built result (no
double serialization — the wrapper stringifies once and hands the host
the original object).

Every span also emits `performance.mark`/`measure` pairs
(`webmcp:update_form#17`), so calls appear natively in the DevTools
Performance panel alongside layout, GC, and network — free correlation
with everything Chrome already records.

## 5 · Host-gap analysis — the differentiator *(shipped)*

A single page can't see inside the host, but it can *bracket* it. The
profiler maintains a session ledger:

- `hostInjectedAt` — when `modelContext` appeared (property-set trap or
  first poll success).
- `toolsRegisteredAt` — when the site finished registering; the delta is
  the site's own registration lag (this app: the ≤ 3 s heartbeat).
- `firstCallAt` — host injection → first tool call = agent warm-up.
- `gapSincePrevCallMs` per span — inside one conversation, the gap
  between a result settling and the next call arriving is host + model
  time, by definition not the page's.

From these the report can state the sentence that matters: *"of the 42 s
this conversation took, tools executed for 0.31 s, payloads totalled
310 KB (~78 K tokens), and 39 s was host/model time"* — turning a vague
"WebMCP feels slow" into an actionable split. It also surfaces the two
site-owned levers hiding in that split: payload weight (§8's detectors)
and registration lag.

## 6 · Synthetic benchmark mode — no agent required *(not yet built in the package; `e2e/perf.mjs` is the v0)*

Every WebMCP tool declares a JSON Schema. The bench runner uses it:

- **Input generation**: walk `inputSchema` — numbers get values swept
  across `[minimum, maximum]`, enums cycle, strings respect
  `maxLength`, optional fields toggle. Deterministic seed → reproducible
  runs. A project can pin exact cases per tool
  (`bench.cases["set_capacity"] = [{capacityMl: 500}, …]`).
- **Safety**: only tools annotated `readOnlyHint: true` run by default.
  Mutating tools need an explicit allowlist, and run inside a
  state-guard: snapshot before / restore after, using a
  project-provided `saveState`/`restoreState` pair (this app would pass
  its store's undo machinery).
- **Output**: min/p50/p95/max per tool, payload sizes, blocking time —
  the same span format as live calls, tagged `synthetic: true`.
- **CI shape**: a Node harness (Playwright + the site's own build)
  invokes the in-page bench and asserts budgets, so a PR that makes a
  tool 10× slower or a payload 10× fatter fails before deploy.
  `e2e/perf.mjs` is the hand-rolled v0 of exactly this.

## 7 · Surfaces *(overlay and console API shipped; beacon and OTel exporter not yet built)*

- **Overlay** (optional, lazy chunk): a shadow-DOM floating panel — no
  style bleed, framework-free — showing a live per-tool table (calls,
  p50/p95, payload, grade), a conversation waterfall (call bars with the
  host gaps drawn between them, so the "where did 40 s go" picture is
  literally visible), and budget violations as badges. Toggle with a
  keyboard chord; hidden by default in production.
- **Console API**: `__webmcpPerf.table()`, `.report()`, `.export()`
  (downloads the JSON), `.bench(opts)` (not yet built), `.reset()` —
  everything works headless from DevTools. Shipped alongside: `.instrument()`
  for the late-load path and `.detach()`.
- **Beacon** (opt-in, not yet built): batched `navigator.sendBeacon` of span
  summaries to any URL, with sampling (`sample: 0.1`) — enough to build
  fleet dashboards of real-user tool performance without an APM vendor.
- **OTel exporter** (opt-in, not yet built): spans as OpenTelemetry JSON with W3C
  trace context, so a backend (this app: the session Durable Object)
  can join page-side spans to server-side ones in one trace view.

### Hidden-browser relay *(BroadcastChannel shipped; WebSocket not yet built)*

The ChatGPT case: the tab being profiled has no visible screen. The
collector can therefore mirror spans out:

- **Same device**: `BroadcastChannel("webmcp-perf:<origin>")` — open the
  same origin in a visible tab, the overlay there renders the hidden
  tab's spans live.
- **Cross-device**: an optional WebSocket relay (any echo-room server;
  this app already has session infrastructure that fits) — pair by
  short code, watch a phone's hidden browser from a desktop overlay.
  Spans only, never payload contents (§10).

## 8 · Budgets, grades, and anti-pattern detectors *(not yet built)*

Configurable budgets with defaults chosen from field data:

```js
budgets: {
  executeP95Ms: 50,       // page compute per call
  blockingP95Ms: 30,      // main-thread hostage time
  resultBytes: 16_384,    // per-result payload
  estTokensPerResult: 4_096,
  registrationLagMs: 1_000,
  schemaBytesPerTool: 4_096,   // schemas ride in EVERY conversation
}
```

Each span and each tool gets a pass/warn/fail grade; the report leads
with violations. On top, pattern detectors that name the fix, not just
the number:

- **Oversized payloads** — an image or state blob past budget, with the
  observed size and the token estimate ("`get_preview_image` returns
  ~130 KB ≈ 32 K tokens per call — consider a smaller default edge").
- **Redundant weight** — near-identical consecutive results (hash
  prefix match) suggest returning deltas or a digest.
- **Chatty sequences** — many small calls inside one host gap window
  where one batched tool would do.
- **Dead surface** — tools registered but never called across N
  sessions: schema bytes paid in every conversation for nothing.
- **Sync jank** — calls whose `blockingMs ≫ wallMs` await (layout
  thrash inside execute).
- **Registration lag** — host injection → tools ready above budget.

## 9 · Distribution and integration *(package shipped; the config below is the designed surface)*

- **Package**: `webmcp-profiler` — zero dependencies, three artifacts:
  ESM (`import { attachProfiler } from "webmcp-profiler"`), a single
  IIFE file for a `<script>` tag / copy-paste, and a bookmarklet build
  of the same IIFE for profiling pages you don't own.
- **Size budget**: core interceptor + collector ≤ 6 KB gzipped; overlay
  and exporters are lazy chunks loaded on first use.

The full config as designed — today's `attachProfiler` accepts only
`buffer`, `relay`, and `overlay`; the other keys arrive with the features
they configure:

```js
const profiler = attachProfiler({
  target: "auto",           // document.modelContext | navigator.modelContext
  buffer: 500,
  persist: true,            // IndexedDB across reloads
  overlay: "chord",         // "on" | "off" | "chord" (keyboard toggle)
  relay: { broadcast: true, ws: null },
  beacon: { url: null, sample: 1 },
  budgets: { /* overrides */ },
  bench: { allowMutating: [], saveState, restoreState },
})
profiler.onSpan(span => …)
profiler.report()           // the versioned JSON document
```

Integration is one line before tool registration; everything else is
config. For this repo it would slot into `src/main.tsx` ahead of
`registerTools`, gated behind `?perf=1` or a localStorage flag so it
costs nothing for ordinary visitors.

## 10 · Privacy and the profiler's own overhead *(shipped, except `captureBodies` and the self-bench)*

- Payload **contents** never leave the page by default — spans carry
  sizes, shapes, hashes, and timings. Turning content capture on
  (`captureBodies: true`) is a local-only debug mode: bodies stay in
  the in-memory buffer, are excluded from beacon/relay/export, and the
  overlay labels the session accordingly.
- The wrapper's hot path is two clock reads and a ring-buffer push;
  observers (longtask, rAF probe) are shared, not per-tool. Measured
  overhead must stay < 1% of a 5 ms call — the profiler CI benches
  itself with and without instrumentation and fails past that.
- Everything is removable at runtime: `profiler.detach()` restores the
  original `registerTool`/`execute` references.

## 11 · Report format *(shipped as `webmcp-perf-report/1`, without grades or detector findings yet)*

One versioned JSON document (`webmcp-perf-report/1`): session metadata
(origin, UA, host flavor, timestamps), the tool table (per-tool
aggregates + grades), the span list, the ledger (§5 totals), and the
detector findings. Stable schema so CI can diff two reports and a
dashboard can ingest a stream of them; the console `.table()` and the
overlay are both views over this same document.

## 12 · Roadmap through this repo

The single source of truth for what has landed; the section markers
above derive from this list.

1. `npm run perf` (shipped) — Playwright bench of every tool, the
   numbers in §1.
2. (shipped) In-page interceptor + collector + console API, live on
   tryunfolded.com behind `?perf=1` — `src/profiler/`, deliberately free
   of app imports so it lifts out unchanged.
3. (shipped) Overlay (`?perf=overlay` or `__webmcpPerf.overlay()`) +
   BroadcastChannel relay: a visible same-origin tab renders spans from
   a hidden agent tab. Note: ChatGPT's hidden and in-app browsers are
   separate browsing contexts, so BroadcastChannel may not bridge them —
   the WebSocket relay (§7) remains the answer there.
4. (structure shipped) `packages/webmcp-profiler` is a workspace package
   — ESM + IIFE + type-declaration builds, `npm pack` verified, publish
   workflow at `.github/workflows/publish-profiler.yml` (dispatch or a
   `webmcp-profiler-v*` tag; needs the NPM_TOKEN repo secret until npm
   trusted publishing is configured). The app consumes the package
   source via the `@/profiler` alias, staying its first consumer.

Shipped alongside step 2: the first finding acted on —
`get_preview_image` went from a 480 px PNG (~130 KB ≈ 32 K tokens per
call) to a 320 px JPEG (~7 KB ≈ 1.7 K tokens), a 19× cut in the single
largest site-owned cost in the agent loop.

Not yet built (in the order they would likely land), each described in
full above so the design is ready when the work is:

5. Budgets, grades, and the anti-pattern detectors (§8), leading the
   report with violations — the first step because it turns the numbers
   the profiler already collects into named fixes.
6. In-page synthetic bench (§6) — `__webmcpPerf.bench(opts)` with the
   `readOnlyHint` safety default and the state-guard for mutating tools;
   `e2e/perf.mjs` retires into it.
7. IndexedDB persistence (§3) so a report can span reloads, and the
   remaining span fields (§4: `queueDelayMs`, `frameDrops`,
   `memoryDeltaBytes`, `schemaValid`).
8. Export paths beyond the JSON download: the beacon and the OTel
   exporter (§7), and `captureBodies` as a local-only debug mode (§10).
9. The WebSocket relay (§7) for cross-device profiling of a hidden
   browser.
