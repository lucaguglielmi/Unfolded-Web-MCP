# webmcp-profiler

A drop-in performance analyser for [WebMCP](https://github.com/webmachinelearning/webmcp)
tool surfaces. One import, zero dependencies, no framework: it wraps
whatever `modelContext` registry a host injects — however late — and
measures every tool call the page serves.

Born inside [tryunfolded.com](https://tryunfolded.com), where it answered
the question *"are the WebMCP tools slow?"* with data: tool execution was
1–15 ms; the seconds people felt were model round trips and one 130 KB
image payload. Full design rationale:
[webmcp-profiler-spec.md](https://github.com/lucaguglielmi/Unfolded-Web-MCP/blob/main/docs/webmcp-profiler-spec.md).

## Why

"WebMCP is slow" is three different problems wearing one coat:

1. **Page compute** — your `execute()` bodies. Fix: optimize code.
2. **Payload weight** — bytes the host must serialize and the model must
   *read as tokens*. Fix: shrink results.
3. **Host + model wait** — the seconds between your result settling and
   the next call arriving. Not yours, but dominant — and worth proving.

A stopwatch around `execute()` only sees the first, usually innocent,
segment. The profiler separates all three, per call and in aggregate.

## Quickstart (on a site that gates it like Unfolded)

```
https://tryunfolded.com/?perf=1        profiling on (persists in localStorage)
https://tryunfolded.com/?perf=overlay  on, with the floating panel open
https://tryunfolded.com/?perf=0        off again
```

Then, in DevTools:

```js
__webmcpPerf.table()    // per-tool calls · p50 · p95 · payload · errors
__webmcpPerf.overlay()  // toggle the floating panel
__webmcpPerf.report()   // the full versioned JSON document
__webmcpPerf.export()   // download that document as a .json file
```

The persistence via localStorage is deliberate: apps rewrite their URLs
(Unfolded live-tracks the design in the address bar), and the tab you
most want to profile — a **hidden agent browser** — can only be steered
once, by a link the agent opens. `open_model` a `?perf=1` URL and the
flag sticks for that tab's origin.

## Integrating it in your own project

```
npm install webmcp-profiler
```

Call the gate first thing at boot, **before** your tool registration
starts:

```ts
import { maybeAttachProfiler } from "webmcp-profiler/attach"   // ?perf=1 gate
maybeAttachProfiler()
```

No bundler? One classic script tag is the whole integration — it exposes
`window.WebMCPProfiler` and runs the `?perf=` gate on load:

```html
<script src="https://cdn.jsdelivr.net/npm/webmcp-profiler@0.1/dist/webmcp-profiler.iife.js"></script>
```

or attach unconditionally / with config:

```ts
import { attachProfiler } from "webmcp-profiler"
const profiler = attachProfiler({
  buffer: 500,      // spans kept in memory
  relay: true,      // mirror spans onto BroadcastChannel "webmcp-perf:<origin>"
  overlay: false,   // open the panel immediately
})
```

No further wiring: the interceptor polls `document` / `navigator` /
`window` `.modelContext` every 250 ms (hosts inject late; the poll is
faster than any site's own registration loop needs to be) and patches
`registerTool` and `provideContext` so every registered tool's
`execute` is instrumented **in place** — the host, your own references,
and console hooks all share the one function, so every caller is
measured. Loaded after tools were already registered? Retrofit any
`{name: tool}` registry you expose:

```js
__webmcpPerf.instrument(window.__myTools)
```

`__webmcpPerf.detach()` restores every original `execute` and stops all
observers.

## What a span records

| field | meaning |
| --- | --- |
| `tool`, `seq`, `invokedAt`, `settledAt` | identity + `performance.now()` window |
| `wallMs` | the `execute()` await, end to end |
| `blockingMs` | Long-Task overlap attributed to the call window (Chromium) |
| `inputBytes`, `resultBytes` | JSON sizes both ways |
| `contentTypes`, `imageBytes` | result content breakdown (`{text: 1, image: 1}`) |
| `estTokens` | `bytes / 4` — the model-side cost of *reading* your result |
| `gapSincePrevCallMs` | idle from the previous result settling to this call arriving — **host + model think time, by definition** |
| `isError`, `error` | tool-reported and thrown failures |

Each call also emits a `performance.measure` (`webmcp:<tool>#<seq>`),
so spans appear natively in the DevTools Performance panel next to
layout, GC, and network.

The **ledger** aggregates the session: totals for calls, wall time,
blocking, payload bytes, estimated tokens, and summed host gaps — plus
when the host injected, when tools registered, and when the first call
landed. Its one-line summary (also the overlay's footer) is the answer
to "where did the time go":

```
tools 0.3s · payloads 310KB (~78K tok) · host gaps 39s
```

## The overlay and the relay

`__webmcpPerf.overlay()` (or `?perf=overlay`) opens a shadow-DOM panel —
no style bleed either way — with the per-tool table and the ledger line,
refreshed at most 4×/s. Every span also mirrors onto
`BroadcastChannel("webmcp-perf:<origin>")`, so an overlay in a *visible*
same-origin tab renders spans recorded in a hidden agent tab live.
(Caveat: ChatGPT's hidden and in-app browsers are separate browsing
contexts; where BroadcastChannel can't bridge, the spec's WebSocket
relay is the plan.)

## The report

`report()` returns a stable, versioned document — `webmcp-perf-report/1`:
session metadata, the ledger, per-tool aggregates (min/p50/p95/max,
errors, payload totals), and the span list. Diff two of them in CI, or
feed a stream of them to a dashboard.

## Agentless benchmarking

The repo pairs the profiler with a synthetic bench —
`npm run perf` (`e2e/perf.mjs`): Playwright drives every tool through
`document.modelContext` exactly as a host would, no agent needed, and
prints per-tool percentiles and payload sizes. Its first two findings on
Unfolded: every tool runs in single-digit milliseconds, and
`get_preview_image`'s 480 px PNG (~130 KB ≈ 32 K tokens per call) had no
business being that heavy — it ships as a 320 px JPEG (~7 KB) now.

## Files

```
src/attach.ts       ?perf= boot gate — zero cost until asked for
src/index.ts        attachProfiler() · console API · BroadcastChannel relay
src/interceptor.ts  registry watching · in-place execute instrumentation
src/collector.ts    span ring buffer · ledger · Long-Task attribution · report
src/overlay.ts      shadow-DOM live panel (lazy-loaded on first use)
src/iife.ts         classic-script entry (auto-runs the gate)
src/profiler.test.ts
```

Home: [`packages/webmcp-profiler`](https://github.com/lucaguglielmi/Unfolded-Web-MCP/tree/main/packages/webmcp-profiler)
in the Unfolded repo, which is also its first consumer. MIT.
