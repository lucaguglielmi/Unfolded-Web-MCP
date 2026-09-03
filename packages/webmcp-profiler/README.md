# webmcp-profiler

[![npm](https://img.shields.io/npm/v/webmcp-profiler?label=webmcp-profiler)](https://www.npmjs.com/package/webmcp-profiler)
[![size](https://img.shields.io/bundlephobia/minzip/webmcp-profiler?label=core%20gz)](https://bundlephobia.com/package/webmcp-profiler)
[![license](https://img.shields.io/npm/l/webmcp-profiler)](./LICENSE)

A drop-in performance analyser for [WebMCP](https://github.com/webmachinelearning/webmcp)
tool surfaces. One import, zero dependencies, no framework: it wraps whatever
`modelContext` registry a host injects, however late, and measures every tool
call the page serves. It also lets the *agent* read the numbers, through a tool.

For a visual explanation of the architecture, measurements, relay,
privacy model, current limits, and roadmap, open
[`index.html`](./index.html) from this package folder.

## Why

"WebMCP is slow" is three different problems wearing one coat:

1. **Page compute**: your `execute()` bodies. Fix: optimize code.
2. **Payload weight**: bytes the host must serialize and the model must *read as
   tokens*, plus the tool schemas the host ships in every conversation. Fix:
   shrink results and descriptors.
3. **Host + model wait**: the seconds between your result settling and the next
   call arriving. Not yours, but dominant, and worth proving.

A stopwatch around `execute()` only sees the first, usually innocent, segment.
The profiler separates all three, per call and in aggregate, and says it in one
line: `schemas 9.8KB (~2.5K tok) · tools 0.3s · payloads 310KB (~78K tok) · host gaps 39s`.

## See it in ten seconds, nothing installed

- **Hosted demo:** [tryunfolded.com/webmcp-profiler/demo/](https://tryunfolded.com/webmcp-profiler/demo/)
  installs a fake host, registers two tools, fires calls by itself, and opens the panel.
- **On a real site:** open [tryunfolded.com/?perf=overlay](https://tryunfolded.com/?perf=overlay),
  then paste one line in DevTools: `__unfoldedTools.set_capacity.execute({ capacityMl: 350 })`.
  The panel fills. `__webmcpPerf.summary()` prints the split.

## Install

```
npm install webmcp-profiler
```

ESM only. Browser runtime; Node 20 or newer to build and to run the bench.
No bundler? The script tag under [Privacy and security](#privacy-and-security)
is the whole integration.

## Quickstart, three ways

**The gate** (recommended). First line at boot, before tool registration starts.
Costs a URL parse and one storage read until someone opens `?perf=1`:

```ts
import { maybeAttachProfiler } from "webmcp-profiler/attach"

maybeAttachProfiler()
```

```
?perf=1        profiling on for this origin (persists in localStorage)
?perf=overlay  on, with the floating panel open
?perf=0        off again
```

**Unconditionally, with configuration:**

```ts
import { attachProfiler } from "webmcp-profiler"

const profiler = attachProfiler({
  buffer: 500,      // spans kept in memory
  relay: true,      // mirror spans to same-origin tabs
  overlay: false,   // open the panel now
  sample: 1,        // measure every call
  onSpan: (span) => console.debug(span.tool, span.wallMs),
})
console.log(profiler.status().message)
```

**The script tag** (also a bookmarklet): exposes `window.WebMCPProfiler` and runs
the `?perf=` gate on load. See [the pinned, integrity-checked tag](#privacy-and-security).

No further wiring: the interceptor watches `document.modelContext` (and the
legacy `navigator` / `window` locations) and patches `registerTool` /
`provideContext` so every registered tool's `execute` is instrumented **in
place**. The host, your own references, and console hooks all share the one
function, so every caller is measured. Loaded after tools were registered?
`__webmcpPerf.instrument(window.__myTools)` retrofits any `{ name: tool }` map.

## Console API

`window.__webmcpPerf` (or your `globalName`). Every member, generated from the
same source as `help()`:

<!-- gen:api -->
| member | what it does |
| --- | --- |
| `active` | true unless this is the server-side no-op or detach() has run |
| `sessionId` | this session's 8-hex id, stamped on every span |
| `spans()` | the raw span ring buffer, oldest first |
| `aggregates()` | per-tool rows: calls, errors, min/p50/p95/max, blocking, bytes, tokens, schema bytes |
| `ledger()` | the session ledger: host timeline, registered tools, running totals |
| `onSpan()` | subscribe to spans as they settle; returns an unsubscribe function |
| `onSpanUpdate()` | subscribe to late corrections (Long-Task blocking); returns unsubscribe |
| `status()` | what the profiler is doing right now: phase, one sentence, and next steps |
| `help()` | print the status line and this method list to the console |
| `summary()` | a few lines of text: the split, then one line per tool |
| `describe()` | the machine-readable manifest of this profiler's API, fields, and configuration |
| `table()` | console.table of the per-tool rows, rounded for reading |
| `report()` | the versioned JSON document; report({ spans: false }) omits spans, { spans: 50 } keeps the newest 50, { tool } filters |
| `export()` | download report() as a .json file |
| `exportTrace()` | download the spans as Chrome trace-event JSON for Perfetto or chrome://tracing |
| `overlay()` | toggle the floating panel (loaded on first use) |
| `instrument()` | retrofit a site-exposed { name: tool } registry wrapped after load; returns how many |
| `synthetic()` | mark spans recorded from now on as synthetic (the bench uses it) |
| `reset()` | clear spans and totals; keeps the tool registry |
| `detach()` | restore every original execute and registry method, stop observing, drop the global |
<!-- /gen:api -->

## Configuration

`attachProfiler(config)` and `maybeAttachProfiler(config)` share the profiler
keys; the gate adds its own. Every default is the 0.1 behaviour:

<!-- gen:config -->
| key | default | what it does |
| --- | --- | --- |
| `buffer` | `500` | spans kept in memory (ring buffer) |
| `relay` | `true` | mirror spans onto a BroadcastChannel so a visible same-origin tab can watch |
| `overlay` | `false` | open the floating panel immediately |
| `globalName` | `"__webmcpPerf"` | window property to expose the API on; false exposes nothing |
| `channel` | `"webmcp-perf:" + location.origin` | BroadcastChannel name for the relay |
| `pollMs` | `250` | registry sweep interval while no host has been found |
| `tokenEstimator` | `bytes/4; images at decoded size` | replaces the bytes-to-tokens heuristic for every content kind |
| `onSpan` | `none` | a listener subscribed at attach time |
| `sample` | `1` | fraction of calls that get a span (0..1); the rest pass through unmeasured |
| `errorPolicy` | `"message"` | what an error span keeps: "message" (capped at 200), "name", or "none" |
| `param` | `"perf"` | query parameter that arms the profiler |
| `storageKey` | `"webmcp-perf:mode"` | localStorage key that persists the mode across URL rewrites |
| `announce` | `true` | console line on attach; false silences, a function replaces it |
| `allow` | `() => true` | the site's last word on whether the gate may open; false also clears a persisted mode |
<!-- /gen:config -->

## See it work in two minutes

No agent host? Install one:

```ts
import { attachProfiler } from "webmcp-profiler"
import { createFakeHost } from "webmcp-profiler/testing"

const host = createFakeHost()          // document.modelContext, draft-shaped
const profiler = attachProfiler({ overlay: true })

document.modelContext!.registerTool({
  name: "hello",
  description: "says hello",
  inputSchema: { type: "object" },
  execute: async () => ({ content: [{ type: "text", text: "hello" }] }),
})
await host.call("hello", {})           // measured, in the panel
console.log(profiler.summary())
```

The fake host honours the draft: `registerTool` returns a promise, an aborted
`signal` unregisters, `getTools()` answers, `toolchange` fires. The same host
is one script string for Playwright (`FAKE_HOST_INIT_SCRIPT`), which is how the
bench and this repository's own end-to-end suite drive a page.
[`examples/vanilla`](./examples/vanilla/index.html) is the same thing as a page.

## Let your agent read it

A WebMCP host agent has no console. Register the report as a tool:

```ts
import { attachProfiler } from "webmcp-profiler"
import { profilerTool } from "webmcp-profiler/tool"

const profiler = attachProfiler()
document.modelContext!.registerTool(profilerTool(profiler))   // name: get_perf_report
```

The tool is read-only, listed in the ledger, never measured. Its result is the
`summary()` text plus a structured view:

<!-- gen:views -->
| view | returns |
| --- | --- |
| `summary` | the split and one row per tool; under 1 KB |
| `tools` | summary plus the full per-tool aggregates |
| `spans` | tools plus the newest spans (limit, default 50; tool and since filters); the heaviest view |
<!-- /gen:views -->

## What a span records

<!-- gen:span -->
| field | meaning |
| --- | --- |
| `sessionId` | the profiler session that recorded the span; '${sessionId}#${seq}' is its identity |
| `seq` | sequence number within the session, from 0 |
| `tool` | the tool's registered name |
| `invokedAt` | performance.now() when execute() was called |
| `settledAt` | performance.now() when execute() resolved or threw |
| `wallMs` | the execute() await, end to end |
| `blockingMs` | Long-Task overlap attributed to this call (fills in after the task ends; Chromium only) |
| `inputBytes` | UTF-8 bytes of the input's JSON |
| `resultBytes` | UTF-8 bytes of the result's JSON |
| `contentTypes` | count per content type, e.g. { text: 1, image: 1 } |
| `imageBytes` | base64 length of image content in the result |
| `estInputTokens` | estimated tokens the model wrote to produce the input |
| `estTextTokens` | estimated tokens to read the non-image part of the result |
| `estImageTokens` | estimated tokens to read the image part of the result |
| `estTokens` | estInputTokens + estTextTokens + estImageTokens: what this call costs the model |
| `isError` | the tool reported isError, or threw |
| `error` | the error message (capped at 200 chars), name, or null, per errorPolicy |
| `gapSincePrevCallMs` | idle from the previous result settling to this call arriving: host + model think time; null when the calls overlapped |
| `synthetic` | recorded by the bench rather than a live host |
| `serializable` | false when the result could not be JSON-serialized (bytes then read 0) |
<!-- /gen:span -->

Each call also emits a `performance.measure` (`webmcp:<tool>#<seq>`), so spans
appear in the DevTools Performance panel next to layout, GC, and network.
Evicted spans clear their measure.

### The ledger

<!-- gen:ledger -->
| field | meaning |
| --- | --- |
| `sessionId` | this profiler session's id |
| `attachedAt` | epoch ms when the profiler attached |
| `hostFoundAt` | performance.now() when a modelContext registry was first seen |
| `hostLocation` | where it was found: document (the draft), navigator or window (legacy hosts) |
| `firstRegistrationAt` | performance.now() of the first registerTool / provideContext |
| `registeredTools` | names currently registered |
| `tools` | per tool: schemaBytes, registeredAt, unregisteredAt, internal |
| `firstCallAt` | performance.now() of the first measured call |
| `lastSettledAt` | performance.now() of the latest settle |
| `totals.calls` | every call seen, measured or not |
| `totals.unsampledCalls` | calls that ran unmeasured because `sample` excluded them |
| `totals.overlappingCalls` | calls invoked before the previous call settled |
| `totals.errors` | calls that reported or threw an error |
| `totals.wallMs` | summed execute() time |
| `totals.blockingMs` | summed Long-Task overlap, union across overlapping calls |
| `totals.resultBytes` | summed result bytes |
| `totals.estTokens` | summed estimated tokens (input + result) |
| `totals.estInputTokens` | summed estimated input tokens |
| `totals.hostGapMs` | summed settled-to-next-invoke gaps: host + model wait, by definition |
| `totals.schemaBytes` | descriptor bytes of the tools currently registered, paid in every conversation |
| `totals.estSchemaTokens` | the same as tokens |
<!-- /gen:ledger -->

## The overlay and the relay

`__webmcpPerf.overlay()` (or `?perf=overlay`) opens a shadow-DOM panel with the
per-tool table and the ledger line, refreshed at most four times a second and
only while the tab is visible. Every span also mirrors onto
`BroadcastChannel("webmcp-perf:<origin>")`, so an overlay in a **visible**
same-origin tab renders the sessions of hidden agent tabs, each as its own
table. Relay input is validated and capped (eight sessions, 500 spans each).
ChatGPT's hidden and in-app browsers are separate browsing contexts that the
channel cannot bridge; use the report tool there.

## The report

`report()` returns `webmcp-perf-report/2`: session metadata, the ledger,
per-tool aggregates, and the spans. A JSON Schema ships at
`webmcp-profiler/schema/report.v2.json`. Costs, measured on a 500-span session
with 14 tools: `report()` about 190 KB; `report({ spans: 50 })` about 25 KB;
`report({ spans: false })` about 6 KB; `summary()` under 2 KB.

Changes from `/1`: bytes are UTF-8 (not UTF-16 units); `estTokens` is the sum
of input, text, and image estimates; `gapSincePrevCallMs` is `null` when calls
overlapped; spans carry `sessionId`; the ledger carries `tools` with schema
bytes; `session.version` names the package version.

## Build your own exporter

```ts
import { attachProfiler } from "webmcp-profiler"

const profiler = attachProfiler({ globalName: false, relay: false, sample: 0.1 })
profiler.onSpan((span) => {
  const { tool, wallMs, resultBytes, estTokens, gapSincePrevCallMs, isError } = span
  navigator.sendBeacon("/perf", JSON.stringify({ tool, wallMs, resultBytes, estTokens, gapSincePrevCallMs, isError }))
})
```

`sample` keeps production volumes down; `globalName: false` and `relay: false`
keep the data out of reach of other scripts and tabs. `exportTrace()` writes
Chrome trace-event JSON that opens in Perfetto.

## Bench and compare, without an agent

```
npx webmcp-profiler bench http://localhost:4173 --runs 40 --json bench.json
npx webmcp-profiler bench http://localhost:4173 --cases perf.cases.json --allow-mutating update_form --budget budgets.json
npx webmcp-profiler compare base.json head.json --thresholds thresholds.json
```

The bench opens the page in Chromium (Playwright, an optional peer), installs
the fake host, generates inputs from every tool's `inputSchema` (numbers sweep
their range, enums cycle, optionals toggle, deterministic under `--seed`), runs
the tools annotated `readOnlyHint: true` (mutating ones only when allow-listed),
and records through the profiler itself, so the output is the same report
document as a live session. `--budget` fails the run past a per-tool p95, byte,
or token ceiling; `--overhead` repeats the run unarmed and prints the delta.
`compare` diffs two reports per tool and judges them against thresholds.
`compare()` is also a plain function you can import.

## Privacy and security

<!-- gen:privacy -->
- spans carry sizes, shapes, timings, tool names, and (per errorPolicy) error messages; never input or result bodies
- nothing leaves the browser: the relay is a same-origin BroadcastChannel and export() is a download
- any same-origin script or tab can read the global and the relay; use globalName: false and relay: false for production telemetry through onSpan
- the gate's allow predicate is the site's last word on who can arm profiling
<!-- /gen:privacy -->

The no-bodies promise is a test: a canary string in a tool's input and result
must appear nowhere in the report, the relay, the hook, or the panel
([`src/index.test.ts`](./src/index.test.ts)). Errors keep their message, capped
at 200 characters, never a stack; `errorPolicy` keeps less.

The script tag, pinned and integrity-checked:

<!-- gen:sri -->
```html
<script src="https://cdn.jsdelivr.net/npm/webmcp-profiler@0.2.3/dist/webmcp-profiler.iife.js"
        integrity="sha384-/nn8SKl53jYeCm2HoR6RlSPp4HyTY1LCFnad7O0olQVarXcMEuK15l4MWV99l2S5" crossorigin="anonymous"></script>
```
<!-- /gen:sri -->

A range URL (`@0.2`) works too but forfeits the integrity check. The same
script is a bookmarklet for pages you do not own; the demo page carries a
drag-to-bookmarks link.

## Using it with Vite

Nothing special: the package is ESM with an `exports` map, `sideEffects`
declared, and no Node globals. Dev-only gate:

```ts
import { maybeAttachProfiler } from "webmcp-profiler/attach"

maybeAttachProfiler({ allow: () => import.meta.env.DEV || location.search.includes("perf=") })
```

Byte-conscious variant, loading the core only when the gate opens:

```ts
import { maybeAttachProfilerLazy } from "webmcp-profiler/attach-lazy"

maybeAttachProfilerLazy().then((profiler) => profiler?.overlay())
```

The lazy form returns a promise, so tools registered before it settles are
wrapped only if the host replays registrations; the sync gate guarantees
ordering. SSR frameworks (SvelteKit, Nuxt, Astro, Remix) get a no-op profiler
on the server and the real one in the browser.

## Host support

| host | `modelContext` on | verified | package |
| --- | --- | --- | --- |
| the fake host (`webmcp-profiler/testing`) | document, navigator, or window | every unit and end-to-end test | 0.2.0 |
| Chrome 152 (Chrome for Testing) with `--enable-features=WebMCPTesting` | document | `e2e/native-host.mjs` in this repo drives tryunfolded.com through Chrome's own host over DevTools: 15 tools plus `get_perf_report` invoked and read back | 0.2.2 |
| Chrome / Edge origin trial | document | not yet verified by the maintainers; rows are added with evidence only | |
| ChatGPT desktop | document (late injection) | not yet verified | |

Long-Task attribution (`blockingMs`) needs Chromium; elsewhere it stays 0.
Under a strict Content Security Policy: the ESM build needs nothing; the
overlay uses constructable stylesheets and falls back to an inline `<style>`
only where they are missing; the script tag needs `script-src` for the CDN;
`export()` navigates to a `blob:` URL.

## Overhead

Measured by [`src/overhead.test.ts`](./src/overhead.test.ts) on every run: the
instrumented p50 is within 0.05 ms of the raw call for a 1 KB result (measured:
about 0.01 ms) and within 1 ms for a 128 KB result (measured: about 0.6 ms, which
is the one JSON serialization of the result). Two clock reads, one ring-buffer
push.

## Troubleshooting

Ask the profiler first: `__webmcpPerf.status()` names the phase and the next
step. The phases and their hints:

<!-- gen:troubleshooting -->
**`no-host`** — attached; no modelContext registry found yet on document, navigator, or window.
- agent browsers inject the registry late, sometimes minutes in: keep the tab open and use the agent
- check the browser: Chrome/Edge need the WebMCP origin trial or flag; ChatGPT desktop has it built in
- no host at all? install a fake one for a dry run: import { createFakeHost } from "webmcp-profiler/testing"

**`host-found`** — registry found; the site has not registered any tools on it yet.
- the site's registration may poll: wait one heartbeat
- registered before the profiler loaded? retrofit the site's own registry: __webmcpPerf.instrument(window.__myTools)

**`tools-registered`** — tools are wrapped; waiting for the first call.
- drive a tool from the agent, or call it yourself from the console: tool.execute({ ... })
- no agent? the bench drives every read-only tool: npx webmcp-profiler bench <url>

**`measuring`** — measuring.
- __webmcpPerf.summary() for the split; .report() for the document; .overlay() for the panel
<!-- /gen:troubleshooting -->

Cases with no phase: **Firefox and Safari** have no Long Tasks, so `blockingMs`
stays 0. **ChatGPT hidden vs in-app browser** are separate contexts; the relay
cannot bridge them, the report tool can. **Strict CSP**: see Host support.
**Tools registered before the profiler loaded**: `instrument()`. **SSR**: the
server gets a no-op; call in the browser.

## Upgrading from 0.1

- Accept format `webmcp-perf-report/2`; byte columns shift for non-ASCII
  payloads, `estTokens` now includes input tokens, `gapSincePrevCallMs` can
  be `null`. `compare()` across the boundary knows this.
- Every 0.1 call site keeps working unchanged: the global, the storage key,
  and the query parameter are the same.
- New: the members, subpaths, and configuration keys listed above.

## Stability

Stable from 0.2: the `attachProfiler` and gate signatures, every default, the
global's name, the report format's versioning rule (a field's meaning changes
only with a format bump). Experimental: the relay, the bench, `compare()`
thresholds. A deprecation is announced one minor release before removal with a
console warning. Semver applies as if 0.x were 1.x: a breaking change bumps the
minor.

## Case study: Unfolded

Born inside [tryunfolded.com](https://tryunfolded.com), a WebMCP-native
parametric designer for slab-built pottery, where it answered "are the tools
slow?" with data: tool execution was single-digit milliseconds; the seconds
people felt were model round trips and one 130 KB image payload, which ships as
a 7 KB JPEG now. The site is the package's first consumer and its regression
suite: it imports the package source, registers `get_perf_report` as its
fifteenth tool, and its agentless bench is `npx webmcp-profiler bench` with a
case file. Numbers: [docs/performance-report.md](https://github.com/lucaguglielmi/Unfolded-Web-MCP/blob/main/docs/performance-report.md).

## Terms

- **span**: one measured tool call.
- **call**: any invocation of a wrapped `execute`, measured or sampled out.
- **ledger**: the session's host timeline, tool registry, and running totals.
- **host gap**: idle from a result settling to the next call arriving; host and
  model wait by definition. The docs use only this term.
- **relay**: the same-origin BroadcastChannel that mirrors spans to other tabs.
- **gate**: `maybeAttachProfiler`, the `?perf=` switch that persists per origin.
- **synthetic**: a span the bench recorded rather than a live host.
- **internal**: the profiler's own report tool, listed and never measured.
- **session**: one `attachProfiler` call, identified by an 8-hex id.
- Naming: the package is `webmcp-profiler`; runtime names use the shorter
  `webmcp-perf` prefix (`__webmcpPerf`, the storage key, the channel, the
  report format), and keep doing so because renaming a global breaks users.

Home: [`packages/webmcp-profiler`](https://github.com/lucaguglielmi/Unfolded-Web-MCP/tree/main/packages/webmcp-profiler)
in the Unfolded repository. Contributing: [CONTRIBUTING.md](./CONTRIBUTING.md).
Security: [SECURITY.md](./SECURITY.md). MIT.
