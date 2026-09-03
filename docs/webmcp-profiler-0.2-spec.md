# webmcp-profiler 0.2 release record

Status: historical release record

Release scope: 0.1.1 to 0.2.0

Historical baseline: main at 85e31b9, with
webmcp-profiler 0.1.1 as the published starting point

Current package: 0.2.4. Use webmcp-profiler-spec.md for the current
package contract. This file records why the 0.2 line was released and is
not a second source of future requirements.

## 1. Release goal

The 0.2 release made the profiler a reusable package rather than an
Unfolded-only internal module. It kept the no-argument 0.1 attachment path
working while adding typed public surfaces, report export, host
compatibility, testing utilities, and an agentless browser benchmark.

The package and Unfolded were released together because the site consumes
the package source directly. App-side behavior, package behavior, and the
whole-repository checks were treated as one change.

## 2. Compatibility and co-evolution

The release preserved attachProfiler and maybeAttachProfiler defaults. It
intentionally changed the report format to
webmcp-perf-report/2 because byte fields became UTF-8 bytes, overlapping
call gaps became null, and token totals were split into input, text, and
image parts.

The old design draft used numbered sections 2.1, 18.1, and 18.5 for the
co-evolution rule, generated manifest, and report tool. Older source
comments may still name those sections; the live meanings are now
documented in the current profiler specification.

## 3. Delivered in 0.2.0

### 3.1 Public package

- typed Span, Ledger, ToolAggregate, PerfReport, and tool types;
- onSpan and onSpanUpdate listeners;
- ledger, status, help, summary, describe, table, and active/sessionId;
- exportTrace and a versioned JSON report;
- configurable global name, relay channel, polling interval, token
  estimator, sampling, and error policy;
- synchronous and lazy activation-gate entry points;
- SSR-safe inactive no-op and idempotent attachment;
- package exports, license, changelog, generated llms content, and
  examples.

### 3.2 Host and measurement behavior

- current document modelContext interception plus legacy navigator/window
  and provideContext compatibility;
- late host and registration discovery;
- registration signal and unregister bookkeeping;
- schema byte accounting;
- UTF-8 payload measurement and split token estimates;
- Long-Task attribution with union totals and relay updates;
- one serialization of each result for measurement;
- restored originals and cleared performance measures on detach/eviction.

### 3.3 Agent and test surfaces

- profilerTool for reading a report through WebMCP;
- createFakeHost and FAKE_HOST_INIT_SCRIPT;
- schema/report.v2.json;
- schema-driven bench and compare command;
- optional Playwright peer dependency for the bench;
- overlay support for local and relayed sessions;
- strict-CSP-compatible overlay behavior and hidden-tab handling.

## 4. Release decisions

The documentation API was loaded lazily by help and describe so the
measurement core stayed small. The lazy gate has its own subpath so a
consumer that wants a minimal boot path does not pull the core into the
same chunk before the gate opens.

The bench remained a Node/browser tool rather than an in-page Profiler
method. Budgets and overhead comparison belong to the bench. The package
did not claim IndexedDB persistence, server relays, telemetry exporters,
body capture, runtime grades, or anti-pattern detection as part of 0.2.

## 5. Patch releases after 0.2.0

### 0.2.1

- corrected registration timing and legacy replacement bookkeeping;
- made the gate work when storage is blocked for the current load;
- improved polling, report snapshots, listener isolation, bench error and
  UTF-8 handling, and report-tool aggregation.

### 0.2.2

- added HTTPS_PROXY and NO_PROXY support to the browser bench and capped
  proxy TLS at 1.2.

### 0.2.3

- stopped retaining wrappers for descriptors that had been unregistered
  and re-created.

### 0.2.4

- linked the package homepage and README to the standalone visual guide.

The package changelog is the authoritative patch-release record.

## 6. Verification record

The release was gated by package tests and the repository's app checks.
The current test and build commands are maintained in AGENTS.md and the
package scripts. Do not infer a current benchmark from this historical
record; performance numbers belong in performance-report.md with a
measurement commit and environment.

## 7. Current pointer

For implementation, use webmcp-profiler-spec.md. In particular:

- its data model is the current report contract;
- its configuration table is generated from the typed package docs;
- its roadmap states what is not shipped;
- its traceability table points to current source files.

The release history in packages/webmcp-profiler/CHANGELOG.md remains
authoritative for published versions.
