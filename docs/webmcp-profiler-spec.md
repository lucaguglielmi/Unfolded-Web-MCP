# webmcp-profiler: current package specification

Status: implemented package with an explicit roadmap

Baseline: package 0.2.4 in the current main implementation at 1a2995d

Last verified: 2026-09-03 against packages/webmcp-profiler/src,
package metadata, generated docs checks, and package tests

This is the source of truth for the current profiler package and future
profiler work. The separate webmcp-profiler-0.2-spec.md is a historical
release record, not a second current requirements document.

## 1. Purpose

webmcp-profiler attaches to a site's WebMCP registration surface and
measures the cost of tool calls. It records browser-side execution time,
Long-Task blocking, payload sizes, estimated tokens, errors, registration
metadata, and the gaps between calls.

It is opt-in. When the gate is closed, the app does not attach the
profiler. When attached, the profiler observes the existing host and tool
registry without changing tool behavior.

## 2. Current package and entry points

The package version is 0.2.4. The report format identifier is
webmcp-perf-report/2.

Public package entry points are:

| Entry | Purpose |
| --- | --- |
| webmcp-profiler | attach the profiler and use the console API |
| webmcp-profiler/attach | synchronous activation gate |
| webmcp-profiler/attach-lazy | gate with lazy core loading |
| webmcp-profiler/tool | expose the profiler report as a WebMCP tool |
| webmcp-profiler/testing | install a fake host for tests and browser benches |
| webmcp-profiler/docs | typed manifest and documentation tables |
| webmcp-profiler/bench | run the agentless browser benchmark |
| webmcp-profiler/iife | browser bundle that attaches at load |
| webmcp-profiler/schema/report.v2.json | report JSON schema |

The package has no production runtime dependencies. Playwright is an
optional peer used by the browser benchmark.

## 3. Activation gate

maybeAttachProfiler and maybeAttachProfilerLazy read a query parameter and
a localStorage preference:

| Input | Effect |
| --- | --- |
| ?perf=1, on, or true | attach and remember mode 1 for this origin |
| ?perf=overlay | attach, remember overlay mode, and open the panel |
| ?perf=0, off, or false | clear the stored mode and stay off |

Defaults:

- query parameter: perf;
- storage key: webmcp-perf:mode;
- console announcement: enabled;
- allow predicate: permitted unless the consuming site rejects it.

The URL wins for the current load. Storage carries the choice across
reloads and URL rewrites. A rejecting allow predicate clears the stored
mode. A server-side call is a frozen inactive no-op.

## 4. Attach and interception

attachProfiler is idempotent while an active instance exists. Calling it
without a browser window returns an inactive no-op. detach restores wrapped
execute functions and registration methods, stops observers, closes the
relay, removes the configured global, and releases the active instance.

The interceptor watches the current draft document.modelContext first and
also supports legacy navigator.modelContext, window.modelContext, and
provideContext registries. It can discover a host and tools injected after
page load. A site can also call instrument with a plain name-to-tool map
when it needs explicit retrofit behavior.

The profiler's own report tool, when registered with profilerTool, is
marked internal and is not measured as a site call.

## 5. Profiler API

An active Profiler exposes:

| Member | Meaning |
| --- | --- |
| active | whether this instance is measuring |
| sessionId | eight-hex session id stamped on spans |
| spans | oldest-first raw ring-buffer spans |
| aggregates | per-tool min, p50, p95, max, errors, blocking, bytes, tokens, and schema bytes |
| ledger | host timeline, registered tools, and totals |
| onSpan | subscribe as calls settle |
| onSpanUpdate | subscribe to late Long-Task corrections |
| status | phase, host location, tool count, calls, and next-step hints |
| help | print status and API documentation |
| summary | compact human-readable split and tool rows |
| describe | load the machine-readable manifest |
| table | print rounded aggregate rows |
| report | return the versioned report document |
| export | download report JSON |
| exportTrace | download Chrome trace-event JSON |
| overlay | lazy-load and toggle the floating panel |
| instrument | wrap a plain tool map |
| synthetic | mark following spans as benchmark-generated |
| reset | clear spans and totals while keeping registration |
| detach | restore originals and stop measuring |

help and describe load the full documentation tables on demand. overlay
also loads its UI on first use.

## 6. Data model

### 6.1 Span

Each measured call records:

- sessionId and sequence number;
- tool name;
- invokedAt, settledAt, and wallMs;
- blockingMs from overlapping Chromium Long Tasks;
- UTF-8 input and result bytes;
- content type counts and image bytes;
- estimated input, text, image, and total tokens;
- isError and an error value governed by errorPolicy;
- gapSincePrevCallMs, which includes host and model wait;
- synthetic and serializable flags.

The default token estimate is bytes divided by four, rounded up. Images
use decoded-size accounting. tokenEstimator can replace this function.
errorPolicy is message, name, or none; messages are capped at 200
characters.

### 6.2 Ledger and aggregates

The ledger records host discovery location and time, registration history,
current tool names, schema bytes, first and last measured call, and totals.
Totals include calls, unsampled calls, overlaps, errors, wall time,
blocking, result bytes, estimated tokens, host gaps, schema bytes, and
schema token estimates.

Aggregates operate over the current ring buffer. A report snapshots the
ledger and spans so later calls cannot mutate an earlier report.

### 6.3 Buffer and sampling

The default ring buffer holds 500 spans. Evicting a span also clears its
performance.measure entry. sample accepts a value from 0 to 1. Calls
excluded by sampling still increment calls and unsampledCalls but do not
produce a span.

## 7. Browser measurements

The wrapper measures execute end to end, serializes input and result once
for byte and token accounting, and records the call in the collector.
Every retained span also has a webmcp tool performance measure.

Long-Task observation is best-effort and Chromium-specific. A Long Task
that arrives after a span settles updates that span through onSpanUpdate.
The ledger blocking total uses the union of overlapping task windows so
concurrent calls are not double-counted there.

The profiler does not store input or result bodies. It stores sizes,
content types, tool names, timings, and an error summary according to the
selected error policy.

## 8. Relay and overlay

With relay enabled, settled spans and late corrections are mirrored over a
BroadcastChannel. The default channel is
webmcp-perf:<current origin>. It is same-origin and device-local; it is
not a server relay and does not provide cross-device collection.

The floating overlay reads the collector and can consume the same-origin
relay. It is lazy-loaded, and hidden-tab behavior is handled by the
overlay rather than forcing the main profiler path to load UI code.

Any same-origin script that can access the configured global or channel can
read the telemetry. For telemetry that must be kept private from page
scripts, use globalName false, relay false, and export through onSpan.

## 9. Reports and agent tool

report returns:

    {
      format: "webmcp-perf-report/2",
      session: { id, origin, userAgent, generatedAt, version },
      ledger,
      tools,
      spans
    }

report accepts spans false to omit spans, a number to keep the newest N,
and tool to restrict the result to one tool.

profilerTool exposes a read-only get_perf_report-style descriptor. Its
views are:

- summary: split and one row per tool;
- tools: summary plus per-tool aggregates;
- spans: newest spans, with optional tool, limit up to 500, and since
  sequence filters.

The structured tool result includes format, package/session information,
status, totals, split, optional tools and spans, truncation, and result
metadata. The internal report tool is never counted as a measured site
call.

## 10. Configuration

attachProfiler accepts:

| Key | Default | Meaning |
| --- | --- | --- |
| buffer | 500 | spans retained in memory |
| relay | true | mirror to a same-origin BroadcastChannel |
| overlay | false | open the panel on attach |
| globalName | __webmcpPerf | global API name; false exposes no global |
| channel | webmcp-perf:<origin> | BroadcastChannel name |
| pollMs | 250 | registry sweep interval before host discovery |
| tokenEstimator | default bytes heuristic | token estimator for all content |
| onSpan | none | listener installed at attach time |
| sample | 1 | measured-call fraction from 0 to 1 |
| errorPolicy | message | error message, name, or none |

The gate additionally accepts param, storageKey, announce, and allow.
announce is a console callback or boolean; allow is the consuming site's
final permission check.

## 11. Benchmark and comparison tooling

The agentless bench is built and exported from webmcp-profiler/bench. It
uses a real browser and the package fake host, drives read-only tools by
default, marks calls synthetic, and returns the same report shape as a
live session. It can use pinned cases or deterministic JSON-Schema input
generation.

Bench options include run count, seed, profiler query parameter, explicit
mutating-tool allowance, registration timeout, Chromium executable path,
headless mode, overhead comparison, and per-tool budgets for p95 time,
result bytes, and estimated tokens. Playwright must be installed and a
Chromium binary must be available.

compare is a pure report comparison helper for thresholds and CI. It
returns tool deltas and a pass/fail-style verdict; it does not mutate
reports or collect telemetry.

## 12. Roadmap and non-goals

The following are not in the current runtime package and must not be
described as shipped:

- IndexedDB persistence across reloads;
- a built-in WebSocket relay for profiler data;
- beacon or OpenTelemetry exporters;
- captureBodies debug mode;
- runtime budget grades and anti-pattern detectors;
- an in-page Profiler.bench method;
- span fields such as queue delay, schema-validity status, memory delta,
  or frame-drop measurements.

The CLI bench, fake host, budgets, overhead comparison, report schema, and
trace export are shipped. Future work may add the roadmap items, but it
must update this section, the typed docs tables, generated README/llms
content, package tests, and the changelog together.

## 13. Compatibility and release rules

The package keeps the current draft WebMCP registration behavior and
legacy host locations for compatibility. The report format identifier is
bumped only when field meaning changes incompatibly.

Changes under packages/webmcp-profiler must land with the app-side changes
that consume them. A package release bumps package.json and adds the
matching changelog entry. Generated README blocks and llms.txt are
regenerated by the package docs command and are not hand-edited.

## 14. Traceability

| Contract | Source |
| --- | --- |
| public API and attachment | src/index.ts, src/attach.ts, src/attach-lazy.ts |
| configuration and gate docs | src/core/defaults.ts, src/gate.ts, src/core/docs.ts |
| spans, ledger, reports | src/core/collector.ts |
| host interception | src/core/interceptor.ts |
| report tool | src/tool.ts |
| fake host | src/testing.ts |
| bench and budgets | src/bench/run.ts and src/bench/inputs.ts |
| report comparison | src/core/compare.ts |
| generated package docs | scripts/docs.mjs, src/readme.test.ts |
