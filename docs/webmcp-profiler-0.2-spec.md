# webmcp-profiler 0.2 — generic-package hardening spec

Status: **landed in 0.2.0** (deviations from the first draft are listed under "Changes since first draft")  
Governing rule: **the profiler and the Unfolded site change together** — every change to the package lands in the same pull request as the app-side updates it needs, and is gated by the whole repo's checks (§2.1)  
Baseline: `main` at `85e31b9` (`Merge pull request #7`), package `webmcp-profiler@0.1.1` as published on npm  
Companion: [`webmcp-profiler-spec.md`](./webmcp-profiler-spec.md) is the long-range design; this document is the work between 0.1.1 and 0.2.0 only.

Changes since first draft (history in git): §15 security, §16
performance, §17 Vite consumers, §18 reusability, §19 documentation, and
§20 adoption were added by later review passes; §2.1, §4.3, §5, §9.1,
§10.1, §11, §13, and §14 were amended in place to carry their config
keys, tests, app-side work, and traceability.

Deviations made while implementing, each for a measured reason:

- `describe()` and `help()` on a `Profiler` return promises: the
  documentation tables are 6.6 KB gzipped and load on demand, which is
  what keeps the core chunk at 3.6 KB. The synchronous `describe()` and
  the tables ship under the `webmcp-profiler/docs` subpath for build-time
  generators and for the site's manifest (§18.1).
- Size ceilings (§16.5): overlay 4 KB and IIFE 14 KB gzipped instead of
  3 KB and 10 KB. The overlay grew with relay validation and per-session
  tables; the IIFE inlines every chunk, the docs included, by design.
  Core 6 KB and attach 1 KB stand (measured 3.6 KB and 0.33 KB).
- Overhead (§16.1): the 128 KB ceiling is 1 ms, measured at about 0.6 ms,
  which is the one JSON serialization of the result. The 1 KB ceiling of
  0.05 ms stands (measured about 0.01 ms).
- The report tool's `summary` view (§18.5) is under 2 KB, not 1 KB: the
  status object and totals travel with it so an agent gets the phase and
  the split in one call.
- Peer dependencies (§15.7): Playwright is declared as an optional peer
  for the bench; the package test asserts every peer is optional and no
  runtime dependency exists.
- The lazy gate (§5, §16.6) lives at `webmcp-profiler/attach-lazy` as
  well as being re-exported from `attach`, because a static re-export
  would pull the core into the same chunk and defeat the point.
- The gate opens on `?perf=on` and `?perf=true` as synonyms of `1` and
  on `off` and `false` as synonyms of `0` (§5), all persisted as `1` or
  cleared.
- `PACKAGE_VERSION` and `session.version` (§4.1) are injected at build
  time; source consumers (the site, tests) see `0.0.0-dev`.

## 1. Purpose

The review of `packages/webmcp-profiler` at the baseline commit found the core sound
(interceptor, collector, detach path, 11 green tests, 2.9 KB gzipped ESM)
and the *integration surface* still shaped like an internal module of
Unfolded: hardcoded names, no typed exports, no hook to get spans out, a
tarball without a license, and a README that leads with tryunfolded.com.
Every finding of that review is turned into ordered, testable work below.
Nothing here changes what the profiler measures for Unfolded; everything
here changes whether a stranger can `npm install` it and trust it. And
nothing here may break the profiler as this very site uses it: Unfolded
is the package's first consumer and its regression suite, so §2.1 binds
every section below.

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

### 2.1 Co-evolution contract with Unfolded

The package grows toward its own repository, but until that day it is a
workspace of this one, and the site is wired to the package *source*,
not the npm build: `vite.config.ts` aliases `@/profiler` to
`packages/webmcp-profiler/src`, and `tsconfig.app.json` typechecks that
directory as part of the app. That wiring is deliberate and stays: it
means every edit to the profiler is compiled, linted, unit-tested, and
driven end to end by Unfolded before it can be published. The contract
that keeps it true:

1. **Same pull request.** A change under `packages/webmcp-profiler/**`
   ships with every app-side change it requires, in one PR. No PR may
   leave the site on an older shape of the package "to be caught up
   later".
2. **Whole-repo gate, never the package alone.** Each such PR runs the
   root `npm run lint && npm test && npm run build && npm run e2e`. The
   package's own `vitest` is a subset of the root run, not a substitute
   for it. The e2e profiler check in `e2e/run.mjs` (`?perf=1` → spans,
   payload accounting, registered-tool count, report format) is the
   live regression test and grows with every section that adds a field.
3. **The app's surface is frozen for 0.2.** These must keep working on
   tryunfolded.com with no change to the app's boot line or links:
   `?perf=1`, `?perf=overlay`, `?perf=0`; the `webmcp-perf:mode`
   storage key; the `__webmcpPerf` global; `maybeAttachProfiler()` with
   no arguments in `src/main.tsx`. Every default in §4.3 and §5 exists
   to satisfy this line.
4. **Public entry points only.** The app imports the package through
   `@/profiler/attach` and `@/profiler/index` and nothing deeper.
   Today `src/pages/agentManifest.ts` imports `REPORT_FORMAT` from
   `@/profiler/collector`, which §12's move to `src/core/` would break;
   §4.1 re-exports the constant from the root, and that import switches
   in the same PR as the move. A lint-style test (§11.10) enforces the
   rule from then on, and it is also the first precondition for
   spinning the package out: an app that only touches public entries
   can swap the alias for the npm package with a one-line change.
5. **The agent manifest is part of the API.** `src/pages/agentManifest.ts`
   tells agents the console methods, span fields, ledger fields, and
   activation flags. Until §18.1 lands, any section that adds or
   renames one (§4.2, §5, §7.3, §7.4, §7.5, §7.7) updates the manifest
   in the same PR, and a test (§11.11) checks the manifest's span field
   list against a real recorded span. Once §18.1 lands, the app embeds
   `describe()` from the package and the hand-written block is deleted:
   the manifest can no longer drift because it is no longer written.
6. **The app-side inventory** that every profiler PR must review:
   `src/main.tsx` (boot gate), `src/pages/agentManifest.ts` (manifest,
   `PERF_STORAGE_KEY`, `REPORT_FORMAT`), `src/pages/WebMCPPage.tsx`
   (console API mentions, npm links), `e2e/run.mjs` (profiler check),
   `e2e/perf.mjs` and `e2e/perf.cases.json` (the agentless bench, its
   `--perf` overhead run, and its case file once §18.7 lands),
   `README.md` (profiler section, subject to the docs guard's word
   ceiling), `docs/performance-report.md` (numbers and claims),
   `.github/workflows/publish-profiler.yml`, the root `AGENTS.md` and
   `.github/pull_request_template.md` (§18.10), and the long-range
   `docs/webmcp-profiler-spec.md`.
7. **Path to its own repository** (not part of 0.2, but 0.2 must not
   make it harder): when the package leaves, the app switches
   `@/profiler/*` to `webmcp-profiler` / `webmcp-profiler/attach`
   (already linked in the lockfile as a workspace), the history goes
   with `git subtree split -P packages/webmcp-profiler`, and the
   publish workflow and `docs/webmcp-profiler-spec.md` move with it.
   Nothing in this spec adds an app import of package internals, an
   app dependency inside the package, or a build step that assumes the
   repo root.

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
  /** fraction of calls that get a span, 0..1; unsampled calls pass through untouched (§16.2) */
  sample?: number                 // 1
  /** what an error span keeps of a thrown error (§15.2) */
  errorPolicy?: "message" | "name" | "none"   // "message"
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
  /** last word on whether the gate may open at all (§15.1) */
  allow?: () => boolean                // () => true
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
  stayed closed, `allow()` returned false, or the environment has no
  `window`.
- `maybeAttachProfilerLazy(config): Promise<Profiler | null>` is the
  same gate with the core loaded by dynamic import only when the gate
  opens (§16.6). It is a second export, not a change to the sync one,
  so `src/main.tsx` keeps its synchronous call and its ordering
  guarantee.

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
The README's report section lists the diff from `/1`. App-side, in
the same PR (§2.1): `e2e/run.mjs` updates its literal to
`webmcp-perf-report/2` (it runs as plain Node against the built site and
cannot import the TypeScript source), `src/pages/agentManifest.ts`
already interpolates `REPORT_FORMAT` and switches its import to the root
entry (§2.1 item 4), and `docs/performance-report.md` re-states any
byte figure it quotes in UTF-8 terms.

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
by id, after validating every message against §15.4. Render order:
the local table when local spans exist, then one
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
4. Console API table (`__webmcpPerf`, or your `globalName`) — a
   generated block (§18.1), never hand-edited.
5. Configuration: `ProfilerConfig` and `GateConfig`, every key, every
   default — generated from the same source.
5a. See it work in two minutes: the example page and the fake host
    (§18.2, §18.3), before any agent host exists.
5b. Let your agent read it: `profilerTool` (§18.5) and the `summary`
    view.
6. What a span records (the §7 fields, UTF-8 bytes, token heuristic and
   how to replace it).
7. The ledger and the one-line split.
8. Overlay and relay, including what the relay can and cannot bridge.
9. The report: `webmcp-perf-report/2` and the diff from `/1`.
10. Build your own exporter: an `onSpan` beacon in eight lines, with
    `sample` for production volumes.
11. Privacy and security statement (§15.6): what a span contains, what
    it never contains, who on the page can read the global, how to arm
    the gate safely, the SRI script tag.
12. Using it with Vite (§17): the three-line recipe, the dev-only gate,
    the lazy gate, SSR frameworks.
13. Host support: the draft's `document.modelContext`, legacy locations,
    Chromium-only Long Tasks, CSP requirements (§15.5).
14. Overhead: the measured numbers from §16.1's self-benchmark.
15. Case study: Unfolded — the `?perf=1` links, the 130 KB → 7 KB
    finding, `npm run perf`. This is where every tryunfolded.com URL now
    lives.
16. Files, license, home.

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

10. `src/mcp/profilerBoundary.test.ts` (app side, §2.1 item 4): every
    `@/profiler/` import under `src/` and `e2e/` resolves to `attach` or
    `index` and nothing deeper.
11. `src/mcp/profilerManifest.test.ts` (app side, §2.1 item 5): records
    one span through a `Collector` and asserts the manifest's
    `span.fields` keys equal the span's keys, and that every
    `consoleApi.methods` name exists on a `Profiler` instance.

12. `privacy.test.ts` (§15.3): the no-bodies invariant.
13. `relay.test.ts` (§15.4): malformed and oversized channel messages
    are dropped; the session and span caps hold.
14. `errors.test.ts` (§15.2): each `errorPolicy`, the length cap, no
    stack traces.
15. `gate.test.ts` additions (§15.1): `allow` false keeps the gate shut
    and clears a persisted mode; the lazy variant resolves to the same
    instance a later sync call returns.
16. `overhead.test.ts` (§16.1): the self-benchmark with its thresholds.
17. `sampling.test.ts` (§16.2): `sample: 0` records no spans and still
    counts calls; `sample: 1` records all.
18. `measures.test.ts` (§16.4): evicted spans clear their
    `performance.measure` entries.
19. `package.test.ts` additions (§15.7, §16.5): `dependencies` and
    `peerDependencies` absent; the size ceilings against a fresh
    `dist/` when one is present.
20. `passthrough.test.ts` (§15.7): `registerTool`'s `exposedTo` option
    and the descriptor's `inputSchema` reach the host untouched.
21. `docs-source.test.ts` (§18.1): `SPAN_FIELDS`, `LEDGER_FIELDS`,
    `METHOD_DOCS`, and `CONFIG_DOCS` cover every key of their types
    (a compile-time check, plus a runtime walk of a recorded span and a
    live `Profiler`); `describe()` is JSON-serializable and stable
    across two calls; the generated README blocks and `llms.txt` match
    the generator's output byte for byte.
22. `testing.test.ts` (§18.2): the fake host honours `signal` abort,
    returns a promise from `registerTool`, answers `getTools()`, fires
    `toolchange`, installs on each location, and uninstalls cleanly.
    The package's own interceptor tests use it instead of the inline
    stub, and the stub is deleted.
23. `status.test.ts` (§18.4): every phase is reachable and each carries
    the documented hints; the overlay shows the status line while
    there are no spans.
24. `tool.test.ts` (§18.5): the tool registers through a fake host,
    is not wrapped, is flagged `internal` in the ledger, and each view
    returns the documented shape under the documented size ceiling.
25. `summary.test.ts` (§18.6): the sentence and the per-tool lines for
    an empty, a one-tool, and a many-tool session; `report({ spans })`
    variants.
26. `schema.test.ts` (§18.8): `report()` validates against
    `schema/report.v2.json` (validator as a devDependency only);
    `compare()` on two hand-built reports yields the documented diff and
    threshold verdicts.
27. `bench.test.ts` (§18.7): input generation from a schema corpus
    (numbers, enums, strings, optionals, nested objects, arrays) is
    deterministic under a seed and respects `readOnlyHint` and the
    allow-list; the harness is exercised end to end by `e2e/perf.mjs`.
28. `help.test.ts` (§18.9): `help()` lists every `Profiler` method with
    its `METHOD_DOCS` line and nothing else.
29. `readme-snippets.test.ts` (§19.10): every fenced `ts` block in the
    package README compiles against the package's own declarations.
30. `claims.test.ts` (§19.10): the retired phrases stay out of the
    package README, the root README's profiler section, the WebMCP page,
    and `agentManifest.ts`; the package README's section order matches
    §10.1; `docs/README.md` lists every file in `docs/`.
31. `jsdoc.test.ts` (§19.5): every exported declaration in
    `dist/*.d.ts` is preceded by a doc comment.

`e2e/run.mjs`'s profiler check additionally asserts `schemaBytes > 0`
for every registered tool and `report.session.id` is 8 hex chars. It
stays the site-level regression test required by §2.1 item 2.
`e2e/perf.mjs` gains the `--perf` flag of §16.7.

## 12. Build

- Move `collector.ts` and `interceptor.ts` to `src/core/`, so Vite's
  directory-derived chunk name becomes `core-<hash>.js` instead of
  `src-<hash>.js`. The `@/profiler` alias in the app still resolves;
  `src/main.tsx` imports `attach`, whose path is unchanged, and
  `agentManifest.ts` moves its `REPORT_FORMAT` import to the root entry
  in the same PR (§2.1 item 4).
- Remove `rollupOptions.output.inlineDynamicImports` from
  `vite.iife.config.ts`; Vite 8 already inlines for a single-entry IIFE
  and warns that the option is ignored.
- `prepublishOnly`: `npm run build && npx publint`.
- Keep sourcemaps and `provenance`.

Acceptance: `npm run build --workspace webmcp-profiler` prints no
warnings; `dist/` contains `core-*.js`, no `src-*.js`.

## 13. Release plan — one version, ordered PRs

All of the above lands in `webmcp-profiler@0.2.0`. Suggested PR order,
each independently green under the whole-repo gate of §2.1, each
carrying its own app-side changes:

1. Packaging and build (§3, §12) plus the package and hygiene tests
   (§11.6, §11.7, §4.5). App side: `agentManifest.ts` import moves to
   the root entry; the boundary test (§11.10) lands.
2. API and safety (§4, §5, §6) with their tests. Additive; defaults
   preserve 0.1.1 behaviour. App side: the manifest's `consoleApi`
   gains `onSpan`, `ledger`, `active`, `sessionId`; the manifest test
   (§11.11) lands; `WebMCPPage.tsx` console-API copy checked.
3. Measurement (§7) and registry (§8), report format `/2`, `CHANGELOG`
   entry. App side: `e2e/run.mjs` literal and new assertions, the
   manifest's `span.fields` and `ledger` text, `performance-report.md`
   byte figures.
4. Overlay and relay (§9) with the DOM tests, relay validation and
   caps (§15.4), CSP-safe styles (§15.5), hidden-tab render pause
   (§16.3). App side: none expected; `?perf=overlay` verified by hand
   on the preview build, once with a strict CSP header served by
   `wrangler dev` to prove §15.5.
5. Security and performance (§15.1–§15.3, §15.7, §16.1, §16.2, §16.4,
   §16.6) with their tests. App side: the manifest's `activation`
   block documents `allow` and `sample`; `e2e/perf.mjs` gains `--perf`
   (§16.7) and its two columns go into `docs/performance-report.md`;
   the publish workflow gains the size step (§16.5) and pinned actions
   (§15.7).
6. Reusability (§18) in two halves. First the source of truth, the
   fake host, `status()`, `help()`, `summary()` and the compact report
   (§18.1, §18.2, §18.4, §18.6, §18.9). App side: `agentManifest.ts`
   embeds `describe()` and deletes its hand-written block; `e2e/run.mjs`
   injects the package's fake-host init script instead of
   `mcpHostInit`. Second the agent tool, the schema and `compare()`,
   the bench, the example, and the tarball reference (§18.3, §18.5,
   §18.7, §18.8). App side: `get_perf_report` registered as the 15th
   tool with its `TOOL_SUMMARIES` row, README tool-table row, prompt
   suite case, and e2e assertion; `e2e/perf.mjs` becomes a case file
   plus one call into the bench; `docs/performance-report.md` re-run
   from the bench's JSON output.
7. Contributor surfaces (§18.10): root `AGENTS.md` with a one-line
   `CLAUDE.md` pointing at it, the PR template, the package
   `CONTRIBUTING.md`. Docs only; may land at any point, earliest is
   best.
8. Docs (§10, §17, §19): the docs index, the canonical framing, the
   four corrections, the glossary, troubleshooting, upgrading notes,
   SECURITY and the moved "Files" section, the snippet and claims
   guards, and the root README's profiler section. Then the version
   bump to 0.2.0 in `package.json`, which is what triggers the publish
   workflow.

Two of §19's items are corrections of statements that are false today
(§19.3) and one is the docs index (§19.1). They are not release-bound
and land first, before PR 1.

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

### 14.1 Reusability review → section

| # | Finding | Closed by |
| --- | --- | --- |
| R1 | Nothing can be seen working without an agent host; three private fake hosts | §18.2 |
| R2 | No example page | §18.3 |
| R3 | Silence when nothing happens | §18.4 |
| R4 | The bench is hardcoded to Unfolded's tools | §18.7 |
| R5 | No published report schema, no diff helper | §18.8 |
| R6 | Console methods not discoverable in place | §18.9 |
| R7 | A WebMCP agent has no way to read the report; the manifest promises one | §18.5 |
| R8 | A full report costs ~40K tokens to read | §18.6 |
| R9 | The package's own description is hand-written in the app's manifest | §18.1 |
| R10 | No agent-readable reference in the tarball | §18.1 (`llms.txt`) |
| R11 | No root guidance file for coding agents | §18.10 |
| R12 | No pull-request checklist for the co-evolution rule | §18.10 |
| R13 | No contributor guide naming the fast loop and the full gate | §18.10 |

### 14.2 Documentation review → section

| # | Finding | Closed by |
| --- | --- | --- |
| D1 | The three-segment framing is written four times in four wordings | §19.2 |
| D2 | Seven documents, no map | §19.1 |
| D3 | Four statements the code does not keep (relay rendering, "stays in your tab", "then read the report", the spec's shipped markers and publish flow) | §19.3, §18.5 |
| D4 | Timing numbers differ across three documents | §19.4 |
| D5 | No API reference; the best one is in Unfolded's manifest | §18.1, §19.5 |
| D6 | Six terms, two names for one thing, no glossary | §19.6 |
| D7 | No troubleshooting for "I see nothing" | §19.7, §18.4 |
| D8 | No CHANGELOG, no upgrade notes | §3.4, §19.8 |
| D9 | Nothing runnable; every snippet is untested prose | §18.3, §19.10 |
| D10 | No CONTRIBUTING, no SECURITY; "Files" on the npm page | §19.9, §18.10 |
| D11 | Snippets can silently rot | §19.10 |
| D12 | Claims can silently rot | §19.10 |
| D13 | Amendment blocks make the specs hard to read cold | §19.11 |
| D14 | Public members without doc comments | §19.5 |

Requirements beyond the review: the co-evolution contract (§2.1) and
its two app-side tests (§11.10, §11.11), which exist so that no row above
can be closed by breaking the site that hosts the package.

Additions beyond the review, flagged where they appear: `pollMs` and the
stop-polling rule (§4.3), null gaps for overlapping calls (§7.7),
`sessionId` (§7.5, required by §7.7 and §9.1), `publint` (§3.3).

## 15. Security

The profiler's threat model is small by construction: it runs as the
site's own script, sees only what the site's tools already return, and
records shapes, sizes, and timings. The review found nothing that gives
an attacker a capability they do not already have as same-origin
script. What follows closes the ways the profiler could *widen* what
same-origin script or a same-origin tab can see, and hardens the parts
of it that touch untrusted input.

### 15.1 Arming is the site's decision, not the link's

Problem: any link with `?perf=1` arms profiling for the origin,
persistently, for whoever clicks it. On Unfolded that is the intended
agent workflow; on a site with a logged-in area it may not be, and 0.1.1
also persisted any value at all.

Change: `GateConfig.allow` (§5) is consulted before the parameter and
before storage. When it returns false the gate neither attaches nor
writes storage, and it clears a previously persisted mode. The README
shows the two common predicates: `() => import.meta.env.DEV` and a
check of a site-issued flag. §5's whitelist of accepted values is
security-motivated as well: nothing arbitrary reaches `localStorage`.

Unfolded keeps the default `() => true`: the agent manifest tells agents
to profile themselves, and the profiler exposes nothing the agent does
not already receive as tool results.

### 15.2 Error strings

Problem: an error span keeps `error.message` verbatim, which travels
into `report()`, `export()`, and every same-origin tab on the relay.
Messages can carry internals (URLs with tokens, SQL, file paths).

Change: `errorPolicy` (§4.3): `"message"` (default) keeps the message
truncated to 200 characters; `"name"` keeps only `error.name`; `"none"`
records `isError` alone. Stack traces are never recorded under any
policy. The Unfolded manifest keeps the default.

### 15.3 The no-bodies invariant is a test

The long-range spec promises that payload contents never leave the page.
0.2 makes it checkable: a test executes a tool whose input and result
each contain a unique canary string, then asserts the canary appears in
none of `JSON.stringify(report())`, the relay message, the `onSpan`
argument, or the overlay's DOM. The README's privacy statement (§15.6)
links to that test by path.

### 15.4 Relay input is untrusted

Problem: `BroadcastChannel` is same-origin, but "same origin" includes
every tab, iframe, and extension content script on that origin. The
overlay in 0.1.1 pushes whatever arrives into an array and renders it.

Change: the overlay validates each message before use: `kind` in
`{span, update}`; `sessionId` matching `/^[0-9a-f]{8}$/`; `seq` a
non-negative integer; `tool` a string of at most 128 characters; every
numeric field finite; `contentTypes` an object of at most 16 string
keys; unknown fields dropped. Anything else is discarded silently. Caps:
at most 8 remote sessions (least recently updated evicted), at most
`buffer` spans per session, and messages beyond 1 000 in one second are
dropped for the rest of that second. Rendering is by `textContent` only
(§9.2), which covers relayed tool names as well as local ones.

### 15.5 Content Security Policy

Problem: the overlay injects an inline `<style>` into its shadow root,
which a `style-src` without `'unsafe-inline'` blocks; the CDN script
tag needs `script-src` to allow the CDN; `export()` navigates to a
`blob:` URL.

Change: the overlay builds its stylesheet with `new CSSStyleSheet()` +
`replaceSync` and `shadow.adoptedStyleSheets`, falling back to the
inline element only where constructable stylesheets are missing. The
README's host-support section lists exactly what a strict CSP must
allow: nothing for the ESM build with the overlay closed; nothing
additional for the overlay on browsers with constructable stylesheets;
`script-src https://cdn.jsdelivr.net` for the script tag; `blob:` where
the browser requires it for `export()`. Unfolded's own headers are the
§2.1 proof: the preview build is run once with a strict policy in PR 4
of §13.

### 15.6 The global and the README's privacy statement

Any script on the page can read `window.__webmcpPerf`, call
`detach()`, or `instrument()` its own objects. That is not an escalation
(same-origin script already owns the page), but consumers who load
third-party scripts should know the data is there. The README's privacy
statement says, in this order: what a span contains (field list), what
it never contains (input and result bodies, stack traces, user
identifiers), that the global and the relay are readable by any
same-origin script or tab, `globalName: false` and `relay: false` for
production telemetry through `onSpan`, and `allow` for gating who can
arm it.

### 15.7 Supply chain and the host boundary

- Zero runtime dependencies stays a hard rule, enforced by the package
  test (`dependencies` and `peerDependencies` absent; the Vite plugin
  of §17.4, if it lands, declares `vite` only as an optional peer via
  `peerDependenciesMeta`).
- The publish workflow pins every action to a commit SHA, keeps
  `permissions` at `contents: read` + `id-token: write`, and keeps
  OIDC trusted publishing with provenance. `npm ci` only; no `npm
  install` in CI.
- `prepublishOnly` refuses a dirty working tree and a version that has
  no `CHANGELOG.md` heading.
- The README's script-tag snippet pins an exact version and carries
  `integrity` and `crossorigin="anonymous"`; the CHANGELOG entry for
  each release records the IIFE's SRI hash, printed by the publish
  workflow and pasted by the release PR. A range URL (`@0.2`) is shown
  only with a sentence saying it forfeits SRI.
- The monkey-patch of a native `document.modelContext` stays a
  pass-through: every argument, including `exposedTo`, and the return
  value reach the host untouched, and the wrapper never reads back or
  rewrites the descriptor's `inputSchema`. §11.20 asserts it.

## 16. Performance

The profiler must never become the thing it measures. 0.1.1's hot path
is already small: two clock reads, one ring push, one `measure`. The
findings below are where it spends more than it needs to, and where a
long agent session grows memory without bound.

### 16.1 A self-benchmark with thresholds

Change: `overhead.test.ts` runs 2 000 calls of a tool returning a 1 KB
result, instrumented and raw, in the same process, and asserts the
instrumented p50 is within 0.05 ms of raw; then 200 calls with a 128 KB
result asserting the overhead is under 0.5 ms per call. The numbers
print in the test output and the README's overhead section quotes the
last measured pair. Thresholds are absolute and generous enough not to
flake on CI runners; the point is to catch a regression of an order of
magnitude, not a microsecond.

### 16.2 Sampling

Change: `ProfilerConfig.sample` (§4.3). The wrapper draws
`Math.random()` once per call; an unsampled call runs the original
`execute` with no serialization, no span, no relay, and the ledger only
increments `totals.calls` and `totals.unsampledCalls`. Default 1, so
Unfolded and every existing consumer see every call. This is the knob
for production telemetry through `onSpan` on high-volume sites.

### 16.3 The overlay does no work nobody sees

Change: renders are skipped while `document.visibilityState ===
"hidden"` and while the panel is hidden, and one render runs on
`visibilitychange` back to visible. The 250 ms coalescing stays. A
hidden agent tab opened with `?perf=overlay` therefore costs nothing
per span beyond the collector. Rows are rebuilt only for tools whose
aggregate changed since the last render (a per-tool `calls` counter
comparison), which keeps the DOM work at O(changed tools).

### 16.4 `performance.measure` entries are bounded

Problem: every call adds a measure to the performance timeline and
nothing removes it; a long session accumulates thousands of entries.

Change: when a span is evicted from the ring buffer, the collector calls
`performance.clearMeasures("webmcp:<tool>#<seq>")`; `reset()` and
`dispose()` clear every `webmcp:` measure. The DevTools view keeps the
same window the ring buffer keeps.

### 16.5 Size ceilings in CI

Change: the publish workflow, after `build`, fails if the gzipped size of
`dist/core-*.js` exceeds 6 KB, `dist/attach.js` 1 KB, the overlay chunk
3 KB, or the IIFE 10 KB. Today's numbers (2.9 / 0.45 / 1.7 / 4.2 KB)
leave room for §7 and §8. The package test (§11.19) runs the same check
locally when a `dist/` exists.

### 16.6 Zero cost when the gate is closed, including bytes

Problem: `attach.ts` imports `./index` statically, so the core rides in
every consumer's main bundle even when the gate never opens. For
Unfolded that is 2.9 KB gzipped against a multi-hundred-KB app; for a
small site it is noticeable.

Change: `maybeAttachProfilerLazy` (§5) loads the core with a dynamic
`import("./index")` only when the gate opens, so bundlers (Vite
included, §17) emit it as a separate chunk. The sync
`maybeAttachProfiler` stays exactly as it is, because its ordering
guarantee (attached before any registration can run) is what Unfolded's
boot line relies on. The README explains the trade: lazy saves bytes
and returns a promise; sync guarantees ordering. Both run the same gate
logic (§5) from one shared function.

### 16.7 Measure the overhead on the real site

Change (app side, §2.1): `e2e/perf.mjs --perf` runs the same cases with
`?perf=1` armed and prints, per tool, the delta of p50 and p95 against
the unarmed run. `docs/performance-report.md` gains one table with both
columns. Expected: deltas within noise for text tools and a visible but
sub-millisecond delta for `get_preview_image`, which is what §7.2's
single serialization buys.

### 16.8 Small things, measured rather than assumed

- `utf8Length` (§7.1) takes a fast path: a native non-ASCII regex test
  first, and only a string that has non-ASCII characters is scanned.
- `aggregates()` is recomputed on demand; at 500 spans it costs under a
  millisecond and stays that way. Incremental per-tool statistics are
  not worth their state; noted so nobody adds them without a number.
- The registry poll (§4.3) is three property reads every 250 ms and
  stops on a native host. No `requestIdleCallback`; the timer throttles
  with the tab like any other.
- Relay `postMessage` per span is one structured clone of a flat object.
  `relay: false` removes it entirely for consumers who use `onSpan`.
- `originals` and `patched` hold strong references to objects the host
  already keeps alive; `detach()` clears both.

## 17. Vite consumers

Vite consumers need nothing special; they were the design target of the
ESM build. What 0.2 guarantees and what it adds:

### 17.1 What works out of the box

- `import { maybeAttachProfiler } from "webmcp-profiler/attach"` and
  `import { attachProfiler } from "webmcp-profiler"` resolve through the
  `exports` map (§3.3). `type: "module"`, `sideEffects` (§3.2), and the
  `types` conditions are what Vite's resolver and TypeScript expect.
- The overlay's dynamic import stays a dynamic import in `dist/`, so
  Vite's production build emits it as its own chunk, and dev-mode
  pre-bundling (`optimizeDeps`) handles it.
- Nothing in the package reads `process.env`, `require`, `__dirname`,
  or Node globals, so neither dev nor build needs polyfills.
- SSR frameworks on Vite (SvelteKit, Nuxt, Astro, Remix) hit §6.1: a
  module that calls `attachProfiler` during server rendering gets the
  no-op profiler and no crash.
- HMR re-evaluates the boot module on a full reload only, and §6.2's
  idempotent attach covers a second evaluation regardless.

### 17.2 The README recipe

```ts
// main.ts — first line, before tool registration starts
import { maybeAttachProfiler } from "webmcp-profiler/attach"
maybeAttachProfiler({ allow: () => import.meta.env.DEV || location.search.includes("perf=") })
```

and the byte-conscious variant:

```ts
import { maybeAttachProfilerLazy } from "webmcp-profiler/attach"
maybeAttachProfilerLazy().then((p) => p?.overlay())
```

The README states the ordering caveat for the lazy form and shows the
`?perf=overlay` link as the way to see it working in `vite dev`.

### 17.3 Verification

§13's validation adds a scratch `npm create vite@latest` app (vanilla
TypeScript template) that installs the packed tarball, uses both recipes,
and is driven by Playwright to produce a `webmcp-perf-report/2`
document in `vite dev` and in `vite preview`. It is a throwaway check
in the release checklist, not a committed fixture.

### 17.4 Optional, after 0.2: a Vite plugin

A `webmcp-profiler/vite` subpath exporting a plugin that injects the
IIFE script tag through `transformIndexHtml` in dev and preview only
(`apply: "serve"` plus an opt-in for preview), so a site profiles in
development with zero application code. It is small and it is the
"make their life easier" item, but it adds a Node-side entry and an
optional peer dependency to a browser package, so it lands in 0.3 with
its own tests, not in this release. The 0.2 README mentions it as
planned so nobody builds a competing one in the meantime.

## 18. Reusability

### 18.0 The root cause, and the shape of the fix

Every reusability finding traces to one fact: the package was lifted out
of an application, and it kept the application's assumptions about who
reads it. Its surfaces are a README for humans and a console for humans
with DevTools. There is no surface for a program (no schema, no fake
host, no harness a stranger can point at their site), and no surface for
an agent (no tool, no compact view, no machine-readable description).
The description that does exist lives in the wrong place: Unfolded's
agent manifest carries the best account of the profiler's API, typed by
hand, and three separate fake hosts live in three private files.

So the fix is not a list of conveniences. It is three structural
decisions, and every subsection below is one of them applied:

1. **The package describes itself, once, in a typed source.** Field
   descriptions, method docs, and config docs are data with types that
   make an undocumented key a compile error. Everything human-, agent-,
   or program-facing (`help()`, `describe()`, the README's API blocks,
   `llms.txt`, Unfolded's manifest, the tool's own description) is a
   projection of that source. Drift becomes impossible rather than
   guarded against.
2. **Agentless by design.** One fake host, exported, modeled on the
   draft, used by the package's tests, the example, the bench, and
   Unfolded's e2e and perf suites. Anyone can produce a span in two
   minutes with no origin trial and no ChatGPT.
3. **The repo teaches its own rules.** The co-evolution contract exists
   in a spec; it must also exist where humans and coding agents look
   before they act: a root guidance file, a pull-request checklist, a
   contributor guide.

### 18.1 One typed source of truth

New module `src/core/docs.ts`:

```ts
/** one line per Span field — adding a field without a line is a type error */
export const SPAN_FIELDS: Record<keyof Span, string> = { … }
export const LEDGER_FIELDS: Record<keyof Ledger | `totals.${keyof Ledger["totals"]}`, string> = { … }
export const METHOD_DOCS: Record<keyof Profiler, string> = { … }
export const CONFIG_DOCS: Record<keyof ProfilerConfig | keyof GateConfig, { doc: string; default: string }> = { … }
export const REPORT_VIEWS: Record<ReportView, string> = { … }

export interface ProfilerManifest {
  package: { name: "webmcp-profiler"; version: string; format: typeof REPORT_FORMAT }
  activation: { param: string; storageKey: string; modes: Record<PerfMode | "0", string>; cost: string }
  console: { global: string | false; methods: Record<keyof Profiler, string> }
  span: Record<keyof Span, string>
  ledger: Record<string, string>
  config: Record<string, { doc: string; default: string }>
  tool: { name: string; views: Record<ReportView, string> } | null
  relay: { channel: string | false; scope: string }
  privacy: string[]
}

export function describe(config?: ProfilerConfig & GateConfig): ProfilerManifest
```

`describe()` is pure: it reads the tables and the resolved config and
returns a JSON-serializable object. `Profiler.describe()` calls it with
the live config and the registered tool name (§18.5). The version is
injected at build time by Vite `define` from `package.json`.

Projections, all generated from this module and nothing else:

- `help()` (§18.9) prints `METHOD_DOCS`.
- The README's "Console API", "Configuration", and "What a span records"
  sections are fenced by `<!-- gen:api -->` … `<!-- /gen:api -->`
  markers and written by `scripts/gen-docs.mjs`, run by `npm run
  docs` and checked by §11.21. A hand edit inside the markers fails the
  test with a diff.
- `llms.txt` in the tarball: the manifest rendered as compact text
  (one heading per key, one line per entry) plus the two-line install
  and the tool snippet. Listed in `files`. This is the agent-readable
  reference; agents that read `node_modules` get the contract without
  parsing prose.
- Unfolded's `agentManifest.ts` replaces its `profiler` block with
  `profiler: describe()`. The block's Unfolded-specific sentences
  (`knownFindings`, the `open_model` hint) move to a sibling
  `profilerNotes` key that stays hand-written and is allowed to be.
- The tool's `description` and `inputSchema` descriptions (§18.5) are
  assembled from `REPORT_VIEWS`.

Acceptance is §11.21. The compile-time part is the point: the moment
§7.3 adds `estInputTokens` to `Span`, `SPAN_FIELDS` fails to type-check
until it has a line, and that line then appears in every projection.

### 18.2 The fake host: `webmcp-profiler/testing`

One implementation of a WebMCP host, modeled on the current draft and
on the legacy shapes the interceptor accepts, exported for everyone
who needs spans without an agent:

```ts
export interface FakeHostOptions {
  /** where to install; default "document" (the draft) */
  location?: "document" | "navigator" | "window"
  /** the legacy provideContext-only shape instead of registerTool */
  legacy?: boolean
  /** resolve registrations on a later tick, as real hosts do; default true */
  async?: boolean
  /** install onto the global immediately; default true */
  install?: boolean
}

export interface FakeHost {
  registry: ModelContextLike             // what the page sees
  tools: ReadonlyMap<string, ToolLike>   // currently registered
  registrations: RegistrationRecord[]    // every registerTool/provideContext call, with its options
  /** call a tool the way a host does: options bag with a signal, awaited */
  call(name: string, input?: unknown, options?: { signal?: AbortSignal }): Promise<unknown>
  /** abort a registration's signal, i.e. unregister, as the draft does */
  unregister(name: string): void
  uninstall(): void
}

export function createFakeHost(options?: FakeHostOptions): FakeHost

/** the same host as a self-contained script string for Playwright's addInitScript */
export const FAKE_HOST_INIT_SCRIPT: string
```

Behaviour: `registerTool` returns a promise, records `exposedTo` and
`signal`, unregisters on abort, replaces on duplicate name; `getTools()`
returns `RegisteredTool`-shaped records for the same origin;
`addEventListener("toolchange")` works and fires on every change;
`legacy: true` exposes only `provideContext`. Errors thrown by a tool
propagate from `call()` exactly as from `execute()`.

Consumers, in order of the drift they remove: the package's own
interceptor tests (the inline `fakeHost()` stub is deleted), the example
page (§18.3), the bench (§18.7, through `FAKE_HOST_INIT_SCRIPT`),
Unfolded's `e2e/run.mjs` (its `mcpHostInit` is deleted) and
`e2e/perf.mjs` (its inline `document.modelContext` stub is deleted).
Three hand-rolled hosts become one tested one, and a change in the
draft's host behaviour is made in one file.

The subpath is in `exports` with `types`, tree-shakeable, and never
imported by `index` or `attach`, so it costs a consumer's bundle nothing
unless used. It is browser code with no test-runner dependency, so it
works in vitest, Playwright, and a plain page alike.

### 18.3 The example page

`packages/webmcp-profiler/examples/vanilla/index.html`: one file, no
build. It loads the IIFE from `../../dist/`, installs the fake host from
`webmcp-profiler/testing`, registers two tools (a fast text tool and a
slow one returning a base64 image), fires ten calls with random pauses,
and opens the overlay. The page states what the reader should see and
what each number means, in the page itself. `npm run example` serves it
with `vite preview` from the package directory. The README's quickstart
links to it as "see it work in two minutes", and the release checklist
opens it by hand.

### 18.4 `status()`: the profiler says what it is doing

```ts
export type ProfilerPhase =
  | "inactive"          // SSR no-op or never attached
  | "no-host"           // attached; no modelContext found yet
  | "host-found"        // registry patched; no tools registered yet
  | "tools-registered"  // tools wrapped; no call yet
  | "measuring"         // at least one span
  | "detached"

export interface ProfilerStatus {
  phase: ProfilerPhase
  /** one sentence a person can act on */
  message: string
  hostLocation: string | null
  hostFoundAt: number | null
  toolCount: number
  callCount: number
  lastCallAt: number | null
  /** concrete next steps for the current phase, in order */
  hints: string[]
}

status(): ProfilerStatus
```

The hints are the troubleshooting section of the README (§19) turned
into data, selected by phase: `no-host` names the three locations
swept and says which agent hosts inject late; `host-found` says
registration has not happened and how to check the site's own
registration path; `tools-registered` says to drive a tool and offers
the `__webmcpPerf.instrument()` retrofit and the fake host;
`measuring` is the ledger line. The overlay shows `message` in place of
"waiting for tool calls…" and refreshes it on phase change. The
`announce` line (§5) prints `message` after its own sentence. `help()`
prints the phase first.

### 18.5 `profilerTool`: agents read the report through a tool

The gap: a WebMCP host agent has no console. The fix belongs in the
package, because every site that adopts the profiler has the same gap.

```ts
import { profilerTool } from "webmcp-profiler/tool"

document.modelContext.registerTool(
  profilerTool(profiler, { name: "get_perf_report" })   // name is the default
)
```

The descriptor: `name` (default `get_perf_report`), `title`
("Performance report for this site's tools"), a `description` assembled
from `REPORT_VIEWS` that tells the agent what each view costs to read,
`annotations: { readOnlyHint: true }`, and

```ts
inputSchema: {
  type: "object",
  properties: {
    view:  { enum: ["summary", "tools", "spans"], default: "summary" },
    tool:  { type: "string", description: "restrict to one tool" },
    limit: { type: "integer", minimum: 1, maximum: 500, default: 50, description: "newest spans to include (view=spans)" },
    since: { type: "integer", description: "only spans with seq greater than this" }
  }
}
```

Result: `content[0]` is the `summary()` text (§18.6) so a host that
reads only text still gets the answer; `structuredContent` is the view:
`summary` → `{ ok, format, session, status, totals, split }` (under
1 KB); `tools` → adds `tools: ToolAggregate[]`; `spans` → adds
`spans` (newest first, bounded by `limit`, filtered by `tool` and
`since`, and `truncated: boolean`). The result records its own
`estTokens` in `structuredContent.meta` so the agent sees what reading
it cost.

The tool is not measured: the descriptor carries a non-enumerable
`PROFILER_INTERNAL` marker and `instrumentTool` skips it, so it never
appears as a span. It is listed in `ledger.tools` with `internal: true`
and its schema bytes count, because the host really does ship them.

Unfolded registers it as its twelfth tool (fifteenth before the tool-performance spec merged four setters into `update_design`). That makes the manifest's
sentence true ("open a `?perf=1` link, work normally, then read the
report") and it is the reference integration for the README. When the
gate is closed the tool is not registered, so an unarmed session
carries no extra schema bytes.

### 18.6 Report views that respect the reader's budget

```ts
summary(): string
report(options?: { spans?: boolean | number; tool?: string }): PerfReport
```

`summary()` returns text, four lines at most plus one per tool:

```
webmcp-profiler · session 3f9a1c2e · measuring · 14 tools · 27 calls
schemas 9.8KB (~2.5K tok) · tools 0.3s · payloads 310KB (~78K tok) · host gaps 39s
  get_preview_image   3 calls · p50 4.8ms · p95 5.1ms · last 7.1KB (~1.8K tok)
  update_form         9 calls · p50 3.2ms · p95 6.0ms · last 812B (~200 tok)
  …
```

`report()` with no arguments is unchanged (all buffered spans).
`{ spans: false }` omits them; `{ spans: 50 }` keeps the newest 50;
`{ tool }` filters spans and aggregates. `export()` keeps the full
document. The README's report section says what each variant costs in
bytes for a 500-span session, measured.

### 18.7 The bench: `webmcp-profiler/bench`

A Node harness, lifted from `e2e/perf.mjs` and made general, so any site
can benchmark its tools in CI without an agent:

```
npx webmcp-profiler bench <url> [--runs 40] [--cases ./perf.cases.json]
    [--allow-mutating a,b] [--seed 1] [--json out.json] [--budget ./budgets.json]
```

- Drives a real browser through Playwright, which is an optional peer
  (`peerDependenciesMeta`), resolved at run time with a clear message if
  absent; `CHROMIUM_PATH` honoured as today.
- Injects `FAKE_HOST_INIT_SCRIPT` (§18.2), opens the URL with the gate
  armed, waits for `status().phase === "tools-registered"`, and reads
  the descriptors through the fake host.
- Generates inputs from each `inputSchema`, deterministically under
  `--seed`: numbers swept across `[minimum, maximum]` (or a documented
  default range), enums cycled, strings by `maxLength`, booleans
  toggled, optionals present and absent, nested objects and arrays
  recursed to depth 3. A case file pins exact inputs per tool and adds
  named variants (Unfolded's "type flip" case).
- Runs tools annotated `readOnlyHint: true` by default; mutating tools
  only when allow-listed, and always in the order of the case file.
- Records through the profiler itself (spans flagged `synthetic: true`),
  so the output is a `webmcp-perf-report/2` document, the same shape as
  a live session, plus a console table identical to today's.
- `--budget` reads `{ [tool]: { p95Ms?, resultBytes?, estTokens? } }`
  and exits non-zero on a violation, naming it. This is the minimum of
  the long-range spec's §8 needed for CI; grades and detectors remain
  there.

App side: `e2e/perf.mjs` becomes `e2e/perf.cases.json` (the current
`CASES` array as data) and a ten-line wrapper that starts `vite
preview` and calls the bench with `--perf` for the overhead run of
§16.7. `docs/performance-report.md` §1 is regenerated from the JSON.

### 18.8 A published schema and `compare()`

- `schema/report.v2.json` in the tarball and in `exports` as
  `./schema/report.v2.json`: JSON Schema (draft 2020-12) for
  `PerfReport`, with `$id` at the package's GitHub raw URL pinned to the
  tag. §11.26 validates a real report against it; the schema is
  hand-maintained and the test is what keeps it honest.
- `compare(base: PerfReport, head: PerfReport, thresholds?): ReportDiff`
  in core, pure: per-tool deltas of p50, p95, last and total bytes,
  tokens, error rate, and schema bytes; new and removed tools; a
  `verdict: "pass" | "fail"` when thresholds are given (the same shape as
  the bench's budgets, expressed as maximum relative or absolute
  growth). The CLI exposes it: `npx webmcp-profiler compare base.json
  head.json --thresholds t.json`. Unfolded's deploy workflow keeps a
  `bench.json` artifact per run and compares against the previous
  green one, non-blocking for one release, then blocking.

### 18.9 `help()`

`help()` prints the current `status().message`, then every `Profiler`
method with its `METHOD_DOCS` line, then the two links (README, example
page). It is the first thing the `announce` line mentions. Nothing in it
is typed by hand.

### 18.10 Contributor surfaces, human and agent

Coding agents and new contributors act on what is in front of them. The
co-evolution contract is in a spec they will not open unprompted, so it
must also live where they look:

- **Root `AGENTS.md`**, with `CLAUDE.md` containing one line pointing to
  it. Contents, in this order, under 400 words: what the repo is (the
  app and the package, and that the app imports the package source);
  the same-PR rule and the app-side inventory (§2.1, copied, not
  linked); the commands (fast loop `npm test --workspace
  webmcp-profiler`, full gate `npm run lint && npm test && npm run build
  && npm run e2e`); the public-entries rule; "generated blocks are
  regenerated, never edited" (§18.1); where the specs live and the
  status-line convention; the docs guard and its word ceiling. A test
  asserts `AGENTS.md` mentions every path in the inventory, so the
  inventory cannot go stale in one place and not the other.
- **`.github/pull_request_template.md`** with the checklist: touched
  `packages/webmcp-profiler`? then app-side inventory reviewed, full
  gate run, generated docs regenerated, CHANGELOG entry, manifest
  unchanged or regenerated. Unchecked boxes are the reviewer's cue.
- **`packages/webmcp-profiler/CONTRIBUTING.md`**: the fast loop, the
  full gate, how to run the example and the bench locally, how to
  regenerate docs, how a release happens (version bump triggers
  publish), and the rule that the package never imports from the app.
  The README's "Files" section moves here.

## 19. Documentation

### 19.0 The root cause, and the shape of the fix

The documentation findings share the reusability root cause and add one
of their own. Prose about the profiler is written separately for each
surface (npm README, root README, two spec documents, the WebMCP page,
the agent manifest, the performance report), and nothing checks any of
it against the code. So the same idea is restated in different words,
numbers drift, and four sentences describe behaviour that does not
exist. Guarding prose after the fact is the weak fix. The strong fix
has three parts:

1. **Generate what can be data.** API, config, span, and ledger
   descriptions are projections of §18.1's typed source. They cannot be
   wrong in one place and right in another because they are written in
   no place.
2. **Verify what must stay prose.** Code snippets compile. Retired
   claims are tested for absence. Public declarations are tested for
   doc comments. A document that cannot be verified is linked, not
   restated.
3. **Say each thing once.** One index, one canonical framing paragraph,
   one source of numbers, one glossary. Every other mention is a link.

### 19.1 The index: `docs/README.md`

One table, one row per document in `docs/`, three columns: what it is,
who it is for, status (design / partly built / landed / snapshot at a
named commit). The profiler rows read, in this order: the package README
(the user manual and the npm page), this spec (the next release), the
long-range spec (the design beyond it), the performance report (the
only numbers; a snapshot at a
named commit), `AGENTS.md` (how to work here). The
root README's profiler section and the package README's "Home" line
both link to the index. §11.30 asserts every file in `docs/` has a row.

### 19.2 The framing, written once

The three-segment paragraph ("page compute, payload weight, host and
model wait; a stopwatch around `execute()` sees only the innocent one")
lives in the package README's "Why" section and nowhere else in full.
The long-range spec §1 keeps its measured table and opens with a link
to the paragraph; the WebMCP page keeps one sentence and links; the
root README keeps its one-sentence version. The paragraph carries no
numbers, so it never goes stale; numbers are §19.4's job.

### 19.3 Four corrections, landed before anything else

These are false today and cost trust with every reader. They are
docs-only, take an hour, and do not wait for 0.2:

1. Package README, overlay and relay: "renders spans recorded in a
   hidden agent tab live" becomes "shows how many spans another tab has
   relayed; rendering them is §9.1 of the 0.2 spec". Rewritten again to
   the true claim when §9.1 lands.
2. WebMCP page, "Off unless you ask": "everything stays in your tab"
   becomes "nothing leaves your browser: spans are visible to other
   tabs on this origin and to you through export, and to no one else".
3. Agent manifest, `profiler.summary`: "then read the report" becomes
   "then call `get_perf_report`" once §18.5 lands; until then, "then
   read it from DevTools with `__webmcpPerf.report()` (a WebMCP host
   cannot call that; a tool is coming)". §2.1 item 5 makes the second
   edit part of the §18.5 PR.
4. Long-range spec §3: the interceptor bullets "late load re-registers
   wrapped copies" and "no host present installs a recording stub" are
   marked *(not yet built)* individually, and §12 item 4 describes
   trusted publishing on a `package.json` change, as the workflow does.

### 19.4 One source of numbers

`docs/performance-report.md` is the only document that states measured
timings, sizes, and token counts, with the commit hash it measured. Every
other document that wants a number links to the report's section
instead; the two allowed exceptions are the README's one-line "first
finding" (130 KB to 7 KB, because it is the story) and the overhead
numbers of §16.1, which the README quotes from the test output with the
package version they were measured at. When the bench (§18.7)
regenerates the report, nothing else needs editing.

### 19.5 The declaration file is the reference

Every exported declaration in the package carries a doc comment: what
it does, its default if it is a config key, the unit if it is a number.
The comment is the same line as the §18.1 tables where one exists, so
hover help, `help()`, the README, and `llms.txt` say the same words.
§11.31 walks `dist/*.d.ts` and fails on an undocumented export. The
README's API blocks are generated (§18.1), so the README cannot say
more or less than the declarations.

### 19.6 Glossary

A "Terms" section at the end of the package README, one line each, in
this order: span, call, ledger, host gap (and its synonyms "think time"
and "host and model wait", which the docs stop using), relay, gate,
synthetic, internal (§18.5), session. One line explains the naming:
the package is `webmcp-profiler`; its runtime names use the shorter
`webmcp-perf` prefix (`__webmcpPerf`, the storage key, the channel, the
report format) and will keep doing so, because renaming a global is a
breaking change with no benefit. The glossary is prose and is the one
README section a hand may edit freely.

### 19.7 Troubleshooting

A README section with one entry per `status()` phase, in the same
words as the phase's `hints` (§18.4), plus the environment cases that
have no phase: Firefox and Safari (no Long Tasks, `blockingMs` stays
0), ChatGPT's hidden versus in-app browsing contexts (the relay cannot
bridge them; use `profilerTool`), a strict CSP (§15.5), a site that
registered tools before the profiler loaded (`instrument()`), and an
SSR framework (§6.1). Each entry ends with the one command or link that
resolves it. The `hints` table in `docs.ts` is the source; the README
section is generated from it inside `<!-- gen:troubleshooting -->`
markers.

### 19.8 Upgrading from 0.1

A README section and the top of the 0.2.0 CHANGELOG entry, the same
text: what changed in meaning (bytes are UTF-8; `estTokens` is now a
sum of three parts; `gapSincePrevCallMs` can be null), what was added
(the fields, the methods, the subpaths), what is unchanged (every
0.1.1 call site; the global; the storage key; the query parameter),
and the one action a consumer of `report()` must take (accept format
`/2`, or run `compare()` across the boundary knowing byte columns
shift for non-ASCII payloads).

### 19.9 The standard files

`CHANGELOG.md` (§3.4), `CONTRIBUTING.md` (§18.10), and
`SECURITY.md`, which is §15.6's privacy statement plus how to report a
vulnerability (a GitHub security advisory on the repo, and the
maintainer's npm-listed email) and the supported-versions line. All
three are in `files`. The README's "Files" section moves to
`CONTRIBUTING.md`, and the README's last section becomes "Terms" then
"Home".

### 19.10 Docs that are tested

- **Snippets compile.** `scripts/extract-snippets.mjs` pulls every
  fenced `ts` block from the package README into
  `src/__snippets__/*.ts` under a `// @ts-check`-style harness that
  imports from the package's public subpaths, and `tsc --noEmit` runs
  over them in §11.29. A snippet that uses a removed option or a
  renamed method fails the build, which is the moment the README should
  change.
- **Claims are guarded.** §11.30 extends the pattern of the existing
  docs guard to the package README, the WebMCP page's two profiler
  sections, and `agentManifest.ts`, with a retired-phrases list seeded
  by §19.3 ("renders spans recorded in a hidden agent tab live",
  "everything stays in your tab", "then read the report" without the
  tool name) and grown whenever a claim is corrected.
- **Structure is guarded.** The same test asserts the package README's
  section order is §10.1's, so a well-meant reorganization that buries
  the install step is caught.
- **Generated blocks are guarded** by §11.21: a hand edit inside
  markers fails with a diff and the instruction to run `npm run docs`.

### 19.11 Spec conventions, applied to this document

For the two profiler specs and the ones that follow:

- The status line says one of: design / partly built / landed, and
  names the baseline commit.
- Amendments go into git history. A document carries one "Changes
  since first draft" paragraph naming the sections added or changed,
  not dated blockquotes. This spec applied the rule to itself in the
  same commit that added this section.
- Every section that changes behaviour has, in order: the problem as
  verified, the change, the acceptance criterion, and the app-side
  work if any. A section without an acceptance criterion is a note,
  and says so.
- A spec that comes from a review carries a traceability table (§14)
  so a finding without a section is visible.
- "Shipped" markers are per bullet, never per section (§19.3 item 4
  is the lesson).
- The long-range spec's §12 stays the single source of truth for what
  has landed; when a 0.2 section lands, §12 gains a line and this
  document's status line moves. Nothing else is edited twice.

## 20. Last review: adoption

Findings of the final pass, after §18 and §19. §14.3 traces them.

### 20.1 Typed tools must be accepted

Problem (verified with `tsc --strict`): `ToolLike.execute` is a property
typed `(input: unknown) => unknown`, which TypeScript checks
contravariantly, so a consumer's `execute: (input: MyInput) => …` is not
assignable. `instrument(myTools)` and the fake host reject exactly the
descriptors TypeScript users have.

Change: declare `execute` with method syntax (bivariant) and forward
`...args: unknown[]`. A compile-time test assigns a descriptor with a
narrowed input type to `ToolLike` and to `Record<string, ToolLike>`.

### 20.2 Demo first

The README's first screen after the one-paragraph "what" is "See it in
ten seconds, nothing installed": the hosted example page (§18.3, served
by the site at `/webmcp-profiler/demo/`) that installs the fake host,
registers two tools, fires calls by itself, and opens the overlay; and
the live-site variant (`tryunfolded.com/?perf=overlay` plus one console
line). A short capture of the overlay filling sits under it, as an
image the npm page renders.

### 20.3 The bookmarklet

The IIFE is already a bookmarklet. The README and the site's WebMCP
page carry a drag-to-bookmarks link whose `javascript:` body injects
the pinned, SRI-checked CDN script and calls `WebMCPProfiler.attach({
overlay: true })`. It is how the profiler reaches sites the reader does
not own.

### 20.4 Tested hosts

A README table: host, where it exposes `modelContext`, what was
verified, at which package version. Rows are added only with evidence.
The fake host (§18.2) is the first row; the Chrome and Edge origin
trials, ChatGPT desktop, and the polyfills people use follow as each is
exercised. Where a polyfill is an npm package it runs in CI, so its row
cannot rot.

### 20.5 Stability promise

A README section: what is stable at 0.2 (`attachProfiler` and the gate
signatures, every default, the report format's versioning rule, the
global's name), what is experimental (relay, bench, `compare()`
thresholds), and that a deprecation is announced one minor release
before removal with a console warning. Semver applies from 0.2 as if
it were 1.x: a breaking change bumps the minor.

### 20.6 Perfetto export

`exportTrace()` writes the buffered spans as Chrome trace-event JSON
(`ph: "X"` complete events, `cat: "webmcp"`, args carrying bytes and
tokens, host gaps as instant events between calls), so a session opens
in Perfetto or `chrome://tracing` beside anything else the reader
traces. Pure function `toTraceEvents(report)` in core; the download is
the console method.

### 20.7 Smoke the tarball in CI

The publish workflow packs the package, installs the tarball into a
scratch directory, and runs a Node script that imports every public
subpath, calls `describe()`, `compare()` on two reports, and validates
a report against the schema. What is tested is what ships.

### 20.8 Small polish

- The wrapped `execute` carries the original's `name` and `length` via
  `Object.defineProperty`, for hosts that introspect.
- The overlay's ledger line is an `aria-live="polite"` region, the
  close button is focusable with a visible focus ring, and the panel
  respects `prefers-reduced-motion` (no backdrop blur).
- A bundle-size badge beside the npm badge.
- Package split (bench and CLI as a sibling package) stays a 0.3
  decision; noted so the subpath layout of §18.7 is not mistaken for
  the final shape.

### 14.3 Adoption review → section

| # | Finding | Closed by |
| --- | --- | --- |
| A1 | Typed tool descriptors do not compile against `ToolLike` | §20.1 |
| A2 | No zero-install way to see it | §20.2 |
| A3 | No way to profile a site you do not own | §20.3 |
| A4 | No evidence of which hosts it was run against | §20.4 |
| A5 | No stability or deprecation promise at 0.x | §20.5 |
| A6 | No export a performance engineer's tools can open | §20.6 |
| A7 | The published tarball is never executed before publish | §20.7 |
| A8 | Wrapper identity, overlay accessibility, size badge | §20.8 |
