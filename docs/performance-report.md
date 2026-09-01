# Performance report — 2026-09-01

App-wide performance audit of tryunfolded.com at commit `364e8f2`+,
covering both the WebMCP tool surface and everything that is *not*
agent-facing: boot, rendering, interaction, PDF export, and memory.

## Methodology

Two instruments, both in this repo:

- **[webmcp-profiler](../packages/webmcp-profiler)** — the performance
  analyser we built for WebMCP tool surfaces (published on npm), plus its
  agentless bench `npm run perf`: real Chromium drives every tool through
  `document.modelContext` exactly as a host would and reports percentiles
  and payload sizes.
- **Playwright + CDP** against the production bundle (`vite preview`),
  run twice: desktop viewport at native speed, and a 390 px viewport at
  **4× CPU throttling** to stand in for a mid-range phone. Paint metrics
  come from the browser's own `PerformanceObserver`.

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
| **discovery metadata** | **9,128 chars (~2,280 tokens) — trimmed 19.6% from 11,360 this pass** |

The metadata trim is the spec §9.1 pair, done in the safe order: the
**standard prompt suite** landed first (`src/mcp/promptSuite.test.ts` —
13 representative potter prompts mapped to the tool that should handle
them, asserting the discriminating phrases survive in that tool's
metadata), then descriptions were cut where they duplicated their own
input schemas. The suite caught two over-trims during the work (the
export tool lost "100% scale"; `start_pairing` lost its full-state
promise) — both restored. The remaining distance to the spec's 25%
aspiration would mean cutting contract sentences the suite protects;
stopping at 19.6% is deliberate. Also stripped: the content-free
`"$schema"` identifier zod emits per tool.

**Verdict: the tool harness is not slow.** Every page-side number is two
to three orders of magnitude below one model round trip. The recurring
costs an agent conversation actually pays are metadata (~2.3 K tokens
once per conversation, now 560 tokens cheaper) and per-result payloads
(minimal).

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

Reading: the app shell is fast even throttled — an agent in a fresh
ChatGPT tab has all 13 tools well under half a second of CPU time. The
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
feel of the main interaction near the deadline): throttle geometry
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
   guarded by the new prompt suite + a 9,800-char budget test that fails
   any future quiet regrowth.
2. **Known, measured, deliberately deferred**: drag updates at 22 ms on
   throttled CPU (30–45 fps drags on mid-range phones). Fix shape
   documented above; risk/benefit says post-submission.
3. **Healthy, no action**: boot, time-to-tools, undo, PDF export, memory,
   payload sizes, and the tool harness itself (0.2 ms floor).
4. **Structural wins already in place**: PDF and 3D stacks are lazy
   chunks; no GPU work is preloaded on browsers that can't use it; the
   preview payload is 19× lighter than its first version.
