# webmcp-profiler 0.2 — generic-package hardening spec

Status: **design spec, nothing landed**  
Baseline: `main` at `85e31b9` (`Merge pull request #7`), package `webmcp-profiler@0.1.1` as published on npm  
Companion: [`webmcp-profiler-spec.md`](./webmcp-profiler-spec.md) is the long-range design; this document is the work between 0.1.1 and 0.2.0 only.

## 1. Purpose

The 2026-09-02 review of `packages/webmcp-profiler` found the core sound
(interceptor, collector, detach path, 11 green tests, 2.9 KB gzipped ESM)
and the *integration surface* still shaped like an internal module of
Unfolded: hardcoded names, no typed exports, no hook to get spans out, a
tarball without a license, and a README that leads with tryunfolded.com.
Every finding of that review is turned into ordered, testable work below.
Nothing here changes what the profiler measures for Unfolded; everything
here changes whether a stranger can `npm install` it and trust it.

§14 is the traceability table: one row per review finding, pointing at the
section that closes it. A finding with no row is a bug in this spec.

## 2. Scope and non-goals

In scope: `packages/webmcp-profiler/**`, its README, its build and publish
configuration, the parts of `docs/webmcp-profiler-spec.md` that describe
what has shipped, and the three app-side call sites that consume the
package (`src/main.tsx`, `src/pages/agentManifest.ts`, `e2e/run.mjs`).

Out of scope: every "not yet built" feature of the long-range spec —
budgets and grades, the in-page bench, IndexedDB persistence, the beacon,
the OTel exporter, the WebSocket relay, `captureBodies`. §4.3's `onSpan`
hook is the deliberate seam that lets consumers build the beacon and OTel
paths themselves until the package ships them.

Compatibility rule for the release: 0.1.1 call sites keep working
unchanged. `attachProfiler()` and `maybeAttachProfiler()` with no
arguments behave as today. The one intentional break is the report
format version (§7.6), because the byte semantics change.

## 3. Packaging

### 3.1 License ships in the tarball

Problem (verified with `npm pack` and the published 0.1.1 tarball): the
tarball holds `dist/`, `README.md`, and `package.json`. The MIT text lives
only at the repo root, which npm does not pull in.

Change: add `packages/webmcp-profiler/LICENSE` (the root text, verbatim)
and list it in `files`.

Acceptance: `npm pack --dry-run` lists `LICENSE`; `npm view` after
publish reports `license: MIT` with the file present.

### 3.2 `sideEffects` names the IIFE

Problem: `"sideEffects": false` while `src/iife.ts` runs
`maybeAttachProfiler()` at module top level. A bundler that resolves
`webmcp-profiler/iife` may drop the whole file as dead code.

Change: `"sideEffects": ["./dist/webmcp-profiler.iife.js"]`. `index`,
`attach`, and the core chunk stay side-effect free (they are).

Acceptance: a unit test reads `package.json` and asserts the array form
naming exactly the IIFE file (§11.6).

### 3.3 Exports map

Problem: `exports["."]` and `exports["./attach"]` carry `types` and
`import` only; `./iife` has no `types` though `dist/iife.d.ts` exists;
there is no `./package.json` subpath; a bare CDN URL
(`https://cdn.jsdelivr.net/npm/webmcp-profiler`) resolves to `main`, the
ESM entry, instead of the script-tag build.

Change:

```jsonc
"exports": {
  ".":         { "types": "./dist/index.d.ts",  "import": "./dist/index.js",  "default": "./dist/index.js" },
  "./attach":  { "types": "./dist/attach.d.ts", "import": "./dist/attach.js", "default": "./dist/attach.js" },
  "./iife":    { "types": "./dist/iife.d.ts",   "default": "./dist/webmcp-profiler.iife.js" },
  "./package.json": "./package.json"
},
"unpkg":    "./dist/webmcp-profiler.iife.js",
"jsdelivr": "./dist/webmcp-profiler.iife.js",
"engines":  { "node": ">=20" }
```

The package stays ESM-only; `main` and `module` remain as they are for
tools that ignore `exports`. The README states "ESM only" in the install
section (§10.1) so CommonJS consumers are told rather than surprised.
`engines` documents the build requirement; runtime is the browser and the
README says so.

Acceptance: `npx publint` (added as a devDependency, run in `prepublishOnly`
before `build`) reports no errors; the §11.6 test asserts the keys above.

### 3.4 CHANGELOG

Change: `packages/webmcp-profiler/CHANGELOG.md`, Keep-a-Changelog format,
in `files`. The 0.2.0 entry is the §13 release list. 0.1.0 and 0.1.1 get
one-line retroactive entries.

## 4. Public API

### 4.1 Types are exported

Problem: `Span`, `ToolAggregate`, `Ledger`, `ToolLike`, `REPORT_FORMAT`
are emitted as d.ts files but unreachable from the package root, and
`report()` returns `Record<string, unknown>`.

Change, in `src/index.ts`:

```ts
export type { Span, ToolAggregate, Ledger, PerfReport, ContentItem, TokenEstimator } from "./core/collector"
export type { ToolLike } from "./core/interceptor"
export { REPORT_FORMAT } from "./core/collector"
```

and a typed report:

```ts
export interface PerfReport {
  format: typeof REPORT_FORMAT
  session: { id: string; origin: string | null; userAgent: string | null; generatedAt: string }
  ledger: Ledger
  tools: ToolAggregate[]
  spans: Span[]
}
```

`Profiler.report(): PerfReport`. `Collector.report()` returns the same
type.

Acceptance: a type-level test (`expectTypeOf`) imports every name from
`"./index"`; `report().format` narrows to the literal.

### 4.2 The `Profiler` interface gains a span hook and the ledger

```ts
export interface Profiler {
  /** true unless this is the SSR no-op (§6.1) or detach() has run */
  active: boolean
  /** this profiler's session id, also stamped on every span (§7.5) */
  sessionId: string
  spans(): readonly Span[]
  aggregates(): ToolAggregate[]
  ledger(): Readonly<Ledger>
  /** subscribe to spans as they settle; returns unsubscribe */
  onSpan(listener: (span: Span) => void): () => void
  table(): void
  report(): PerfReport
  export(): void
  overlay(): void
  instrument(tools: Record<string, ToolLike>): number
  reset(): void
  detach(): void
}
```

`onSpan` is the collector's existing listener set, exposed. A listener
that throws is caught and reported once via `console.error`, and never
breaks the tool call or other listeners. `ProfilerConfig.onSpan` (§4.3)
is sugar for subscribing at attach time.

### 4.3 `ProfilerConfig`

```ts
export interface ProfilerConfig {
  buffer?: number                 // 500
  relay?: boolean                 // true
  overlay?: boolean               // false
  /** window property to expose the API on; false = don't expose */
  globalName?: string | false     // "__webmcpPerf"
  /** BroadcastChannel name; default `webmcp-perf:${location.origin}` */
  channel?: string
  /** registry sweep interval (ms) while no host has been found */
  pollMs?: number                 // 250
  /** override the bytes→tokens heuristic (§7.3) */
  tokenEstimator?: TokenEstimator
  /** convenience for onSpan() at attach time */
  onSpan?: (span: Span) => void
}
```

Every string that 0.1.1 hardcodes is now either a config key here or a
gate option in §5. The defaults are the 0.1.1 values, so Unfolded and
every existing consumer see no change.

`pollMs` (an addition beyond the review list, included because the
config surface is being defined once): the sweep keeps polling for the
life of the page today. Behaviour after this spec: poll at `pollMs` until
a registry has been found on all three spots *or* until
`document.modelContext` is found and is a native platform object
(`Object.getPrototypeOf(registry) !== Object.prototype`), at which point
polling stops, since a real implementation is present from page load and
nothing later will replace it. Polyfill and extension hosts, which inject
plain objects, keep the poll running as today. `detach()` still clears
the timer.

### 4.4 `table()` is for eyes

Problem: `console.table(aggregates())` prints 13-digit floats.

Change: `table()` maps aggregates to display rows: milliseconds rounded
to one decimal, column headers carrying units (`p50 (ms)`, `total (KB)`,
`schema (B)`), tokens with thousands separators. `aggregates()` stays
raw numbers.

### 4.5 Shipped declaration comments describe the package, not the repo

Problem: `dist/index.d.ts` opens with "everything under src/profiler/
lifts out of this repo unchanged (roadmap step 4)". Consumers read that
in their IDE.

Change: rewrite the file-header comment of every `src/*.ts` in the
package to describe the module for a consumer. The words `src/profiler`,
`roadmap`, `this repo`, `this app`, `Unfolded`, and `tryunfolded` may not
appear in any file under `packages/webmcp-profiler/src` except
`profiler.test.ts`.

Acceptance: a test greps the source tree for those tokens (§11.7).

## 5. The boot gate is configurable

Problem: `maybeAttachProfiler()` takes no arguments; the `perf` query
parameter, the `webmcp-perf:mode` storage key, and the console
announcement are fixed; the gate cannot pass `buffer` or `relay`; any
value other than `0` is persisted and treated as "on" (`?perf=banana`
attaches); the function returns `void`.

Change:

```ts
export interface GateConfig extends ProfilerConfig {
  /** query parameter that arms the profiler */
  param?: string                       // "perf"
  /** localStorage key that persists the mode */
  storageKey?: string                  // "webmcp-perf:mode"
  /** console.info line on attach; false silences, a function replaces */
  announce?: boolean | ((profiler: Profiler) => void)   // true
}

export type PerfMode = "1" | "overlay"

export function maybeAttachProfiler(config: GateConfig = {}): Profiler | null
```

Rules:

- Accepted values: `1`, `on`, `true` (all persist as `"1"`), `overlay`,
  and `0`, `off`, `false` (all clear the key). Anything else is ignored:
  not persisted, not attached, one `console.warn` naming the accepted
  values.
- The announcement names the configured `globalName`, never the literal
  `__webmcpPerf`.
- `PERF_STORAGE_KEY` stays exported as the default; a consumer using a
  custom `storageKey` reads their own constant.
- The `ProfilerConfig` part of `GateConfig` is forwarded to
  `attachProfiler` unchanged, with `overlay` forced true for mode
  `overlay`.
- The return value is the profiler when attached, `null` when the gate
  stayed closed or the environment has no `window`.

Unfolded's `src/main.tsx` keeps calling `maybeAttachProfiler()` with no
arguments.

## 6. Environment safety

### 6.1 SSR no-op

Problem: `attachProfiler` reads `document`, `location`, `window`, and
`navigator` unguarded; a Next.js or Astro module that calls it at import
time crashes on the server.

Change: when `typeof window === "undefined"` or `typeof document ===
"undefined"`, `attachProfiler` returns a frozen no-op `Profiler` whose
`active` is `false`, whose readers return empty values, whose `report()`
returns a valid document with zero spans, and whose mutators do nothing.
`maybeAttachProfiler` returns `null` in the same situation. `Collector`
itself stays environment-free except the `PerformanceObserver` probe it
already guards.

Acceptance: a test runs both entry points with `window` and `document`
stubbed to `undefined` and asserts no throw and the no-op shape.

### 6.2 Attach is idempotent

Problem (verified by reading `instrumentTool`): the wrapped marker is a
symbol on the *function*, so a second `attachProfiler()` wraps every new
tool for its own collector first and the first collector's wrapper is
then skipped. Two instances silently split the data, and
`window.__webmcpPerf` is overwritten.

Change: the module keeps one `active` instance. `attachProfiler()` while
one is active returns that instance and logs one `console.warn`
("already attached; call detach() first"). `detach()` clears the slot. A
consumer who needs two collectors is asking for a feature the package
does not have; the long-range spec's `onSpan` covers fan-out instead.

Acceptance: the existing "detach then re-attach" test is kept; a new
test attaches twice, asserts `===`, registers a tool, and asserts one
span in the one instance.

## 7. Measurement accuracy

### 7.1 Bytes are bytes

Problem: `JSON.stringify(v).length` counts UTF-16 code units; a
non-ASCII payload is undercounted by up to 3x.

Change: `utf8Length(json: string): number` in the collector — a code-unit
scan that counts 1/2/3 bytes per character and 4 per surrogate pair, no
`TextEncoder` allocation. All of `inputBytes`, `resultBytes`,
`imageBytes` (base64 is ASCII so unchanged in practice), and
`schemaBytes` (§7.4) use it. The README's span table says "UTF-8 bytes
of the JSON serialization".

Acceptance: a test with a CJK and an emoji payload asserts the UTF-8
count against `new TextEncoder().encode(json).byteLength`.

### 7.2 One serialization per call

Problem: the wrapper stringifies the result in `summarizeResult` and
again for `estTokens`; for Unfolded's image tool that was the profiler's
single largest self-cost, and §10 of the long-range spec promises one
serialization.

Change: the wrapper calls `JSON.stringify` exactly once for the input
and once for the result, and every derived number (`resultBytes`,
`estTokens`, `contentTypes`, `imageBytes`) comes from that one string
plus a walk of the already-built object. Non-serializable results
(cycles, BigInt) record `resultBytes: 0` and `serializable: false` on
the span rather than throwing.

Acceptance: a test spies on `JSON.stringify` around one call and asserts
exactly two invocations.

### 7.3 Token estimates by content type, input included, and pluggable

Problem: `estTokens = resultBytes / 4` regardless of content; base64
image data does not tokenize like text; the input the model *writes*
(its most expensive tokens) is not estimated at all.

Change:

```ts
export type TokenEstimator = (part: {
  kind: "text" | "image" | "other" | "input"
  bytes: number
  mimeType?: string
}) => number
```

Default estimator: `text`, `other`, `input`: `ceil(bytes / 4)`; `image`:
`ceil(bytes * 0.75 / 4)` on the base64 length (the decoded size at the
same text rate — still a heuristic, but a labelled one; the README says
that vision models bill images by pixel count and that the consumer
should override with a model-specific estimator).

Span fields: `estInputTokens`, `estTextTokens`, `estImageTokens`, and
`estTokens` = the three summed. Aggregates and ledger totals carry
`estInputTokens` beside `estTokens`. `ProfilerConfig.tokenEstimator`
replaces the default for all four kinds.

### 7.4 Schema weight per tool

Problem: the cost paid in *every* conversation — the tool descriptors the
host serializes into the model's context — is never recorded, although
the interceptor holds each descriptor at registration.

Change: at `instrumentTool` time compute `schemaBytes = utf8Length(
JSON.stringify({ name, title, description, inputSchema, annotations }))`
from whatever of those fields the descriptor has. Ledger gains
`tools: Record<string, { schemaBytes: number; registeredAt: number;
unregisteredAt: number | null }>` (`registeredTools: string[]` stays for
compatibility and lists the currently registered names). Ledger totals
gain `schemaBytes` and `estSchemaTokens` (sum over currently registered
tools). `ToolAggregate` gains `schemaBytes`. The overlay ledger line
becomes `schemas 9.8KB (~2.5K tok) · tools 0.3s · payloads 310KB (~78K
tok) · host gaps 39s`.

### 7.5 Session id and span id

Change: each `attachProfiler` mints `sessionId` (8 hex chars from
`crypto.getRandomValues`, falling back to `Math.random` only where
`crypto` is absent). Every span carries `sessionId`, and `report().session.id`
is the same value. This is the key that §7.7 and §9.1 need to merge
relayed data by source. `seq` remains per session; `${sessionId}#${seq}`
is the span's identity.

### 7.6 Report format version

`REPORT_FORMAT = "webmcp-perf-report/2"`. Reasons: §7.1 changes the
meaning of every byte field, §7.3 and §7.4 add fields, §7.5 adds ids.
The README's report section lists the diff from `/1`. App-side:
`e2e/run.mjs` compares against the constant imported from the package
source instead of a string literal, and `src/pages/agentManifest.ts`
already interpolates `REPORT_FORMAT`.

### 7.7 Long-Task attribution and concurrency

Problem: when two calls overlap in time, one Long-Task entry adds its
overlap to *each* span and to the ledger total once per span, so the
total double-counts; and `blockingMs` mutates spans after they were
already relayed, so a remote overlay never sees blocking.

Change:

- Per span: unchanged, each overlapping span gets its own overlap (that
  is that span's truth).
- Ledger total: the entry's overlap with the *merged* union of the
  overlapping spans' windows, computed by sorting the overlapping spans
  by `invokedAt` and coalescing adjacent intervals before intersecting
  with the entry.
- Relay: when attribution lands, the collector emits an `update` event
  `{ kind: "update", sessionId, seq, blockingMs }` on the same channel;
  the overlay merges it by id (§9.1). `onSpan` listeners are not
  re-called; a new `onSpanUpdate(listener)` is exposed on `Profiler` for
  consumers who want the late fields.
- Gap semantics (an addition beyond the review list, adjacent to the
  same code): `gapSincePrevCallMs` is `null`, not negative, when the call
  was invoked before the previous call settled, and the ledger counts
  such calls in `totals.overlappingCalls`. The README defines the gap as
  "idle between the previous settle and this invoke; null when the calls
  overlapped".

Acceptance: a test drives the collector with a fake
`PerformanceObserver` and two overlapping spans; per-span sums exceed
the ledger total, and the total equals the union overlap.

## 8. Registry surface and the current draft

Problem: the interceptor comments say the proposal has "no enumeration
API"; the current draft exposes `modelContext` on `Document` only, with
`registerTool`, `getTools()`, `executeTool()`, and a `toolchange`
event, and a `registerTool` whose `signal` abort unregisters the tool.
The ledger's `registeredTools` only ever grows. `navigator` and `window`
locations, `provideContext`, `unregisterTool`, and `clearContext` are
legacy host shapes.

Change:

- Sweep order stays `document → navigator → window`; `hostLocation`
  records which one; the README and the interceptor comment call
  `document` the standard and the other two legacy.
- On `registerTool(tool, { signal })`, when a signal is present the
  interceptor subscribes to its `abort` and marks the tool unregistered
  in the ledger (§7.4's `unregisteredAt`), restoring nothing (the host
  drops the tool; the wrapper on the site's object stays harmless and is
  still restored by `detach()`).
- Where the registry has `unregisterTool(name)` or `clearContext()`
  (legacy hosts), they are patched the same way `registerTool` is, to
  mark tools unregistered; `unpatchAll` restores them.
- Where the registry supports `addEventListener`, the interceptor listens
  for `toolchange` and, if `getTools()` exists, reconciles
  `registeredTools` with the same-origin names it returns. This only
  corrects the timeline and names; it cannot wrap `execute`, because
  `RegisteredTool` does not expose it, and the README says so in the
  late-load paragraph.
- The interceptor comment about enumeration is rewritten to the above.

Acceptance: fake-host tests for abort-unregisters, `unregisterTool`,
`clearContext`, and `toolchange` + `getTools` reconciliation.

## 9. Overlay and relay

### 9.1 The relay renders

Problem: the README promises that a visible same-origin tab "renders
spans recorded in a hidden agent tab live"; the overlay only prints "+N
spans relayed" above an empty local table and a zeroed ledger.

Change: the aggregate and ledger-totals arithmetic move out of
`Collector` into pure functions, `aggregateSpans(spans)` and
`totalsFromSpans(spans)`, used by both the collector and the overlay.
The overlay keeps a `Map<sessionId, Span[]>` of relayed spans (ring of
`buffer` per session, default 500) and applies §7.7 `update` messages
by id. Render order: the local table when local spans exist, then one
block per remote session titled `relayed · <sessionId>` with its own
table and ledger line. A tab with no local calls therefore shows the
hidden tab's real per-tool table as its main content. The "waiting for
tool calls…" placeholder stays until either source has data.

### 9.2 Escaping

Problem: tool names are interpolated into `innerHTML` unescaped.

Change: rows are built with `document.createElement` and `textContent`;
the only `innerHTML` left is the static shell. Acceptance: a test
registers a tool named `<img src=x onerror=…>` and asserts the panel
contains it as text and no `img` element.

## 10. Documentation

### 10.1 Package README, in this order

1. One paragraph: what it measures and the three-segment split.
2. Install: `npm install webmcp-profiler`, "ESM only, browser runtime,
   Node ≥ 20 to build".
3. Quickstart, three ways: the gate import, the script tag (bare CDN URL
   now works, §3.3), explicit `attachProfiler(config)`.
4. Console API table (`__webmcpPerf`, or your `globalName`).
5. Configuration: `ProfilerConfig` and `GateConfig`, every key, every
   default.
6. What a span records (the §7 fields, UTF-8 bytes, token heuristic and
   how to replace it).
7. The ledger and the one-line split.
8. Overlay and relay, including what the relay can and cannot bridge.
9. The report: `webmcp-perf-report/2` and the diff from `/1`.
10. Build your own exporter: an `onSpan` beacon in eight lines.
11. Host support: the draft's `document.modelContext`, legacy locations,
    Chromium-only Long Tasks.
12. Case study: Unfolded — the `?perf=1` links, the 130 KB → 7 KB
    finding, `npm run perf`. This is where every tryunfolded.com URL now
    lives.
13. Files, license, home.

### 10.2 Long-range spec catches up

`docs/webmcp-profiler-spec.md` §12 item 4 says the publish workflow
needs `NPM_TOKEN` and a `webmcp-profiler-v*` tag; the workflow uses npm
trusted publishing (OIDC) on a push that changes
`packages/webmcp-profiler/package.json`. Rewrite item 4 to say that, and
add item 4b summarizing this spec's release. `docs/` stays out of the
tarball; every link from the README to a doc is a GitHub URL pinned to
`main`.

## 11. Tests

The package's `vitest` runs under the root config today, in the `node`
environment with hand-stubbed globals. Additions:

1. `happy-dom` as a root devDependency; DOM tests carry
   `// @vitest-environment happy-dom` per file.
2. `gate.test.ts`: each accepted and rejected value of §5, custom
   `param` and `storageKey`, forwarding of `buffer`/`relay`, the return
   value, the announcement naming `globalName`.
3. `overlay.test.ts`: rows render, §9.2 escaping, remote sessions render
   their own table, `update` messages merge, `destroy()` removes the host
   and closes the channel.
4. `collector.test.ts` additions: §7.1 UTF-8, §7.2 single serialization,
   §7.3 per-kind tokens and the estimator override, §7.4 schema bytes,
   §7.7 union attribution and null gaps.
5. `interceptor.test.ts` additions: §8 unregister paths, §6.2
   idempotence.
6. `package.test.ts`: reads `package.json` and asserts §3.1–§3.3
   (`files` includes `LICENSE` and `CHANGELOG.md`, the file exists,
   `sideEffects` is the array, every export subpath has `types` where a
   d.ts exists, `unpkg`/`jsdelivr` point at the IIFE).
7. `hygiene.test.ts`: §4.5's forbidden tokens across `src/**/*.ts`
   excluding tests.
8. `types.test-d.ts`: §4.1 `expectTypeOf` round-trip of `PerfReport`
   and every exported type.
9. `ssr.test.ts`: §6.1.

`e2e/run.mjs`'s profiler check additionally asserts `schemaBytes > 0`
for every registered tool and `report.session.id` is 8 hex chars.

## 12. Build

- Move `collector.ts` and `interceptor.ts` to `src/core/`, so Vite's
  directory-derived chunk name becomes `core-<hash>.js` instead of
  `src-<hash>.js`. The `@/profiler` alias in the app still resolves;
  `src/main.tsx` imports `attach`, whose path is unchanged.
- Remove `rollupOptions.output.inlineDynamicImports` from
  `vite.iife.config.ts`; Vite 8 already inlines for a single-entry IIFE
  and warns that the option is ignored.
- `prepublishOnly`: `npm run build && npx publint`.
- Keep sourcemaps and `provenance`.

Acceptance: `npm run build --workspace webmcp-profiler` prints no
warnings; `dist/` contains `core-*.js`, no `src-*.js`.

## 13. Release plan — one version, ordered PRs

All of the above lands in `webmcp-profiler@0.2.0`. Suggested PR order,
each independently green:

1. Packaging and build (§3, §12) plus the package and hygiene tests
   (§11.6, §11.7, §4.5). No behaviour change.
2. API and safety (§4, §5, §6) with their tests. Additive; defaults
   preserve 0.1.1 behaviour.
3. Measurement (§7) and registry (§8), report format `/2`, app-side
   `e2e/run.mjs` update, `CHANGELOG` entry.
4. Overlay and relay (§9) with the DOM tests.
5. Docs (§10), then the version bump to 0.2.0 in `package.json`, which
   is what triggers the publish workflow.

Validation before the bump: root `npm run lint && npm test && npm run
build && npm run e2e` green; `npm pack --dry-run` shows `LICENSE`,
`CHANGELOG.md`, `README.md`, `package.json`, `dist/`; `npx publint`
clean; a scratch Vite app and a plain HTML page each consume the packed
tarball (import, `/attach`, script tag) and produce a report with
`format: "webmcp-perf-report/2"`.

## 14. Traceability — review finding → section

| # | Review finding | Closed by |
| --- | --- | --- |
| 1 | No LICENSE in the tarball | §3.1 |
| 2 | `sideEffects: false` wrong for the IIFE entry | §3.2 |
| 3 | Types not exported; `report()` untyped | §4.1 |
| 4 | No `onSpan` on the public `Profiler` | §4.2, §4.3 |
| 5 | Hardcoded param, storage key, global, channel, message; gate takes no config | §4.3, §5 |
| 6 | Exports map: only `import`; no `types` for `./iife`; no `./package.json`; no `unpkg`/`jsdelivr` | §3.3 |
| 7 | Not SSR-safe | §6.1 |
| 8 | Double `attachProfiler()` breaks the first instance | §6.2 |
| 9 | Stale repo-internal comments shipped in d.ts | §4.5, §11.7 |
| 10 | Bytes are UTF-16 code units | §7.1 |
| 11 | Result serialized twice per call | §7.2 |
| 12 | One token formula for all content; no input tokens; not pluggable | §7.3 |
| 13 | Schema weight never recorded | §7.4 |
| 14 | Long-Task total double-counts overlapping calls; relay never sees `blockingMs` | §7.7 |
| 15 | Relay overlay shows a counter, not the remote table | §9.1 |
| 16 | Spec drift: `document` only, `getTools`/`toolchange`, unregister never removes names | §8 |
| 17 | Overlay `innerHTML` unescaped | §9.2 |
| 18 | README leads with Unfolded | §10.1 |
| 19 | Spec §12 stale on the publish workflow; `docs/` not in tarball | §10.2 |
| 20 | No DOM-side tests (gate, overlay, report shape, Long Tasks) | §11 |
| 21 | Vite 8 warning; `src-<hash>` chunk name; no CHANGELOG; no `engines` | §12, §3.4, §3.3 |
| 22 | `table()` prints unrounded floats | §4.4 |

Additions beyond the review, flagged where they appear: `pollMs` and the
stop-polling rule (§4.3), null gaps for overlapping calls (§7.7),
`sessionId` (§7.5, required by §7.7 and §9.1), `publint` (§3.3).
