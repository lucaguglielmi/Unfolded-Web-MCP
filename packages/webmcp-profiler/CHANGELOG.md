# Changelog

All notable changes to `webmcp-profiler`. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
semver as if 0.x were 1.x (a breaking change bumps the minor).

## [Unreleased]

## [0.2.1]

### Fixed

- The ledger records a tool when the host accepts it (promise resolved,
  signal not aborted), not when the site asks; a burst of concurrent
  registrations, an already-aborted signal, or a rejected descriptor no
  longer leaves phantom or missing tools.
- `provideContext` replaces the tool set in the ledger, as the legacy
  hosts that expose it do.
- The gate honours `?perf=1` for the current load even where storage is
  blocked; storage only carries the mode across loads.
- Registry polling continues while the found registries are plain
  objects, so a polyfill that replaces its registry is patched again.
- `report()` returns a snapshot; an earlier report no longer changes as
  the session continues, which `compare(base, head)` relies on.
- `onSpanUpdate` listeners are isolated from each other like `onSpan`.
- Bench: the overhead pass pairs rows by index, a throwing tool is
  counted per call instead of aborting the run, result bytes are UTF-8,
  and the quantile is the package's own.
- The report tool aggregates once per call.

## [0.2.0]

The release that makes the package generic. Design:
[docs/webmcp-profiler-0.2-spec.md](https://github.com/lucaguglielmi/Unfolded-Web-MCP/blob/main/docs/webmcp-profiler-0.2-spec.md).

### Upgrading from 0.1

- **Report format is `webmcp-perf-report/2`.** Byte fields now count
  UTF-8 bytes (0.1 counted UTF-16 code units, undercounting non-ASCII
  payloads by up to 3x). `estTokens` is now the sum of `estInputTokens`,
  `estTextTokens`, and `estImageTokens`. `gapSincePrevCallMs` is `null`
  when calls overlapped (0.1 stored a negative number). Consumers of
  `report()` accept format `/2`; byte columns shift for non-ASCII payloads.
- **Nothing else changes for 0.1 call sites.** `attachProfiler()` and
  `maybeAttachProfiler()` with no arguments behave as before; the global,
  the storage key, and the query parameter are unchanged.

### Added

- Public types (`Span`, `Ledger`, `ToolAggregate`, `PerfReport`, `ToolLike`,
  `REPORT_FORMAT`) and typed `report()`.
- `onSpan`, `onSpanUpdate`, `ledger()`, `status()`, `help()`, `summary()`,
  `describe()`, `exportTrace()`, `synthetic()`, `active`, `sessionId`.
- Configuration: `globalName`, `channel`, `pollMs`, `tokenEstimator`,
  `onSpan`, `sample`, `errorPolicy`; gate: `param`, `storageKey`,
  `announce`, `allow`. `maybeAttachProfilerLazy` and the
  `webmcp-profiler/attach-lazy` subpath.
- `webmcp-profiler/tool`: `profilerTool()`, a WebMCP tool that returns the
  report so agents can read it.
- `webmcp-profiler/testing`: `createFakeHost()` and `FAKE_HOST_INIT_SCRIPT`.
- `webmcp-profiler/bench` and the `webmcp-profiler` CLI: `bench <url>` with
  schema-driven inputs and budgets; `compare a.json b.json`.
- `compare()` and `schema/report.v2.json`.
- Schema bytes per tool and in the ledger; session ids on spans; Long-Task
  union attribution with relay updates; unregistration tracking
  (`signal` abort, `unregisterTool`, `clearContext`, `toolchange`).
- The overlay renders relayed sessions as their own tables, validates relay
  input, pauses in hidden tabs, and uses constructable stylesheets under
  strict CSP.
- SSR-safe no-op profiler; idempotent attach.
- `LICENSE`, `CHANGELOG.md`, `llms.txt`, `examples/vanilla`.

### Fixed

- Results were serialized twice per call; once now.
- `sideEffects` named the IIFE; the exports map gained `default`
  conditions, `types` for `./iife`, `./package.json`, and CDN fields.
- Typed tool descriptors are assignable to `ToolLike`.
- Wrapped `execute` keeps the original's `name` and `length`.
- `table()` prints rounded numbers with units.
- Evicted spans clear their `performance.measure` entries.

## [0.1.1]

- README and metadata corrections after the first publish.

## [0.1.0]

- First publish: interceptor, collector, ledger, console API, overlay,
  BroadcastChannel relay, ESM and IIFE builds.
