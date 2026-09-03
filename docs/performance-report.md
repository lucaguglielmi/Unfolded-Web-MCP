# Performance evidence

Status: dated evidence, not a current performance contract

Recorded snapshot: the app audit labelled 364e8f2 and the follow-up
tool-performance runs described below

Last reviewed: 2026-09-03. The figures have not been rerun as part of this
documentation cleanup; later code or browser changes may make them stale.

The current performance rules are in webmcp-tool-performance-spec.md. This
file keeps measured evidence and explains how to replace it.

## 1. What was measured

The recorded app audit used a production bundle served by vite preview and
Playwright/CDP:

- desktop at native speed;
- a 390-pixel viewport with 4x CPU throttling;
- browser PerformanceObserver paint timings;
- page-side tool timings and payload sizes;
- a separate native-host run for the WebMCP invocation path.

The page was served locally, so network transfer time was not part of the
timings. Bundle sizes were recorded separately. The one-off app audit
script was not committed, so its results are evidence rather than a
repeatable CI baseline.

## 2. Recorded WebMCP results

These are the last recorded post-tool-performance values. They are
historical measurements, not budgets for every future browser:

| Case | Runs | p50 | p95 | Result or metadata |
| --- | ---: | ---: | ---: | ---: |
| describe_project | 40 | 0.4 ms | 1.3 ms | 1,270 B result |
| get_template_summary | 40 | 0.3 ms | 0.5 ms | 1,262 B result |
| update_design, height | 40 | 5.2 ms | 9.8 ms | 1,293 B result |
| update_design, type flip | 40 | 5.2 ms | 8.1 ms | 1,397 B result |
| update_design, clay | 40 | 2.4 ms | 4.7 ms | 1,401 B result |
| update_design, capacity | 40 | 2.9 ms | 5.6 ms | 1,491 B result |
| update_design, units | 40 | 3.5 ms | 7.6 ms | 1,429 B result |
| update_design, combined | 40 | 3.3 ms | 4.8 ms | 1,449 B result |
| apply_preset | 40 | 3.7 ms | 5.5 ms | 1,309 B result |
| undo_last_change | 40 | 2.9 ms | 4.4 ms | 1,405 B result |
| open_model | 40 | 2.3 ms | 4.0 ms | 1,297 B result |
| get_preview_image | 15 | 1.7 ms | 6.2 ms | 7,378 B result |

The same run recorded discovery metadata at 8,912 characters with a
9,350-character test budget. The run was made around the tool-surface
change and should be refreshed whenever descriptions or schemas change.
The current unarmed surface is 11 tools; an armed profiler adds the
conditional get_perf_report tool.

The profiler overhead pass found no meaningful page-side regression in the
recorded environment. The native-host run added roughly 280 ms of fixed
host-side latency per invocation in that browser build, which is why
round-trip count matters more than shaving a fraction of a millisecond from
the page path.

## 3. Recorded app results

### 3.1 Boot and load

| Metric | Desktop native | 390-pixel viewport, 4x CPU |
| --- | ---: | ---: |
| first contentful paint | 64 ms | 80 ms |
| DOMContentLoaded | 94 ms | 247 ms |
| WebMCP tools registered | 150 ms | 468 ms |
| 3D canvas mounted | 469 ms | 928 ms |
| largest contentful paint | 64 ms | 2.0 s |
| JavaScript heap after load | 11 MB | 12 MB |

Recorded gzip bundle inventory: shell 142 KB, CSS 11 KB, PDF pipeline
158 KB, and 3D stack 251 KB. PDF and 3D code were lazy chunks.

### 3.2 Interaction

The main recorded hotspot was a rapid slider drag on 4x CPU:

- 5.2 ms per update on desktop;
- 22.1 ms per update on throttled CPU;
- roughly 30 to 45 frames per second during the active drag in that
  environment.

The cost was dominated by rebuilding the 3D lathe geometry for every
intermediate value. This was a measured deferral, not a claim that the
interaction is functionally broken.

### 3.3 PDF export and memory

| Metric | Desktop native | 4x CPU |
| --- | ---: | ---: |
| first PDF export | 955 ms | 1.17 s |
| subsequent PDF export | 601 ms | 604 ms |

The first export included the lazy PDF chunk. The audit observed 11 to
12 MB of JavaScript heap with the full 3D scene and no leak pressure in
the tested burst.

## 4. Current contract cross-check

Numbers above use an older measurement snapshot. The current contract is
the important part:

- update_design is the combined mutation path;
- state results use structuredContent contract tool-result/2;
- create_live_handoff returns a live capability only after a successful
  mint and fails without any URL;
- designUrl is permanent and parameter-only;
- get_preview_image returns a bounded JPEG or an honest text fallback;
- get_perf_report exists only when profiling is armed;
- the profiler report format is webmcp-perf-report/2.

Do not copy the old tool names update_form, set_clay, set_units, or
set_capacity into new documentation. They were merged into update_design.

## 5. Refresh procedure

For a new reproducible snapshot:

1. build the package and app;
2. run npm run perf -- --overhead against the intended local preview;
3. record the commit, browser version, OS, viewport, CPU throttle, run
   counts, and whether a fake or native host was used;
4. record discovery metadata and the exact tool surface separately;
5. update this file's recorded-snapshot header and tables;
6. run the unit, build, docs, and applicable end-to-end checks.

The package bench requires Playwright and a Chromium binary. A missing
browser binary or an unavailable Worker/network approval is a verification
limitation, not a passing result. CI installs those dependencies before
running its browser and Worker gates.

## 6. Interpretation

The evidence supports three practical conclusions:

1. The page-side tool work is small; agent and host round trips dominate
   perceived latency.
2. Combining related edits reduces round trips and creates a clearer
   one-step undo experience.
3. The preview and lazy chunks deserve payload and loading checks even when
   tool execution itself is fast.

Any new optimization should add a dated measurement and explain the
tradeoff. Do not turn a one-off number into a requirement without moving
the requirement into the current tool-performance specification.
