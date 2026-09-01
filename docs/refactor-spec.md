# Refactoring Spec — Code Quality Pass

> Status: working notes from the 2026-08-30 review. Several items have since
> landed through other work (see git history, which is authoritative); the
> ground rules below still describe the frozen public contracts correctly.

Goal: a codebase that reads as deliberately engineered end to end — clear module
boundaries, no duplicated contracts, no test-only seams leaking into production
code, and measured performance choices. This document turns the findings of the
2026-08-30 architecture/performance review into ordered, verifiable work items.

**Deadline context:** the WebMCP Challenge submission closes Sep 3. Features are
frozen; only the items in this spec land before the deadline, in priority order.
Anything not finished by then moves to "after".

## Ground rules (apply to every item)

- **Public contracts are frozen.** These must be byte-for-byte stable across the
  whole refactor:
  - WebMCP tool names, input schemas, and result shapes (`src/mcp/tools.ts`)
  - Share-link query parameters and their parsing (`src/lib/model/shareLink.ts`)
  - The localStorage keys (`unfolded:project:v1`, the nudge-dismissed key)
  - The three-state agent status semantics (explicit-signal-only ChatGPT state)
- **Each item ships alone**: one commit per item (or per numbered sub-step),
  with `npm run lint && npm test && npm run build && npm run e2e` green before
  every push. The deploy pipeline is the final gate.
- **No behavior changes** unless the item explicitly says so. Items marked
  *(behavior)* change something observable and say exactly what.
- Update this file as items land (move them to the Done section). Delete the
  file in the final pre-submission commit — the codebase should speak for
  itself by then.

---

## P0 — correctness and contract hygiene (do first, all small)

### 1. Unit-aware warnings in `describeTemplates` *(behavior: bugfix)*
`useProjectStore.ts:458` calls `formWarnings(form, clay)` without the unit, so
`get_template_summary` reports piece dimensions in inches but warnings in cm
when the potter prefers inches. `describeState` already passes the unit.
- **Change:** pass `unit` through, mirroring `describeState`.
- **Accept:** a unit test asserting `describeTemplates().warnings` renders in
  inches when `unit === "in"` (drive a warning via an extreme taper).

### 2. `shareUrl` options object
The positional signature `(form, clay, paperSize, unit, opts)` already caused
one real bug (an old call site passed `opts` in the `unit` slot →
`units=[object Object]`). Make misuse a type error.
- **Change:** `shareUrl(form, clay, paperSize, { unit, viaChatGpt })` (unit
  optional, defaulting to `"cm"`); update all call sites and tests. Same for
  `buildShareParams` if it reads better.
- **Accept:** `tsc` catches a positional-style call; all existing share-link
  tests pass unchanged in expectation.

### 3. Derive `PdfModule` from the real module
The hand-written `PdfModule` interface in the store duplicates
`pdf.ts`'s export signature; optional fields mean drift fails silently (adding
`unit` required editing both by hand).
- **Change:** `type PdfModule = typeof import("@/lib/export/pdf")` (or
  `Pick<...>` of it) so the compiler pins them together.
- **Accept:** removing a parameter from `exportTemplatesPdf` breaks the build.

### 4. Origin-agnostic OG tags
`index.html` hardcodes `og:url`/`og:image` to the workers.dev domain while the
rest of the app is deliberately origin-independent.
- **Change:** keep absolute URLs (crawlers need them) but source the domain from
  one build-time constant (vite `define` or a single documented line) so a
  domain move is a one-line change, and note it in the README deploy section.
- **Accept:** grepping the repo for the domain finds exactly one authoritative
  occurrence (plus README mention).

---

## P1 — architecture: module boundaries (the visible craftsmanship)

### 5. Split `useProjectStore.ts` (460 lines, four responsibilities)
Target layout, no logic changes:
- `src/store/useProjectStore.ts` — the zustand store only (state + actions +
  history). Exports the store and its types.
- `src/store/persistence.ts` — `loadPersistedProject`, `startProjectPersistence`.
- `src/store/urlSync.ts` — `applyShareLinkFromLocation`, `startShareLinkSync`.
- `src/mcp/describe.ts` — `describeState`, `describeTemplates` (they format
  strings *for agents*; they belong to the MCP layer, next to `tools.ts`).
- **Accept:** every existing test passes with only import-path updates; the
  store file no longer imports from `export/svg` or `export/pdf` types except
  what its own actions need; file lengths roughly 200/60/60/90.

### 6. Store factory instead of module-global test seams
`lastHistoryPushAt` and `importPdfModule` are module-level mutables, which is
the only reason `_resetHistoryCoalescing` and `_setPdfModuleForTests` exist.
- **Change:** `createProjectStore(deps?: { now?; loadPdfModule? })` returning
  the store with the coalescing clock and pdf loader held in closure; the app
  exports the singleton `useProjectStore = createProjectStore()`. Tests build
  fresh instances with injected `now`/loader and the two `_test` exports are
  deleted.
- **Accept:** no exported identifier prefixed `_` remains in `src/`; store
  tests no longer share state between cases (no `beforeEach` reset of fields
  the test doesn't own).

### 7. Single source of truth for the tool surface
Tool metadata currently lives in four places: `tools.ts`, the `/webmcp` TOOLS
list, the README table, and e2e `EXPECTED_TOOLS`. Every new tool touches all
four.
- **Change:** export `TOOL_SUMMARIES: { name, blurb }[]` from `src/mcp/tools.ts`
  (blurb = the short human line; descriptions stay as-is for agents).
  `WebMCPPage` renders it and derives the "registers eleven tools" count from
  it; README keeps its table with a comment pointing at the source (README
  can't import). **e2e's `EXPECTED_TOOLS` stays hand-written on purpose**: it
  is the independent contract check, and deriving it from the code under test
  would make it tautological (it also can't — `run.mjs` is plain Node, no TS).
  Add a comment there saying exactly that.
- **Accept:** adding a dummy tool in `tools.ts` makes `/webmcp` pick it up with
  zero further edits — and e2e FAILS until `EXPECTED_TOOLS` is deliberately
  updated. That failure is the feature.

### 8. Decompose the preview cluster in `App.tsx`
The morphing preview div branches on `previewExpanded × previewCollapsed × lg:`
inside single `cn()` calls. Preserve the load-bearing constraint — **one
`<Viewport>` instance, never remounted** — while making the three shapes
legible.
- **Change:** extract `PreviewCluster` (owns expanded/collapsed state, the
  scroll handler, and the class-shape logic as named class-map constants),
  `ShareDialog`, and `UndoRedoControls` into `src/components/` files. `App.tsx`
  keeps routing, header, and layout skeleton only (~150 lines).
- **Accept:** `App.tsx` under ~180 lines; React devtools shows `<Viewport>`
  keyed/mounted once across thumbnail → collapsed → expanded transitions
  (verify via the existing e2e flows plus a manual check that the WebGL canvas
  is not recreated — `registerPreviewCanvas` fires once).

### 9. Commit-based undo coalescing *(behavior: sharper undo)*
Wall-clock coalescing (800 ms) makes long slider drags burn several undo steps
and merges distinct rapid actions. The sliders already distinguish change vs.
commit (`onValueCommit` — used for haptics today).
- **Change:** give the store an explicit transaction primitive:
  `beginCoalescing()/endCoalescing()` (or `withUndoStep(fn)`) driven by slider
  pointer-down/commit; `openModel` uses the same primitive instead of relying
  on the 800 ms window; the timer remains only as a fallback for keyboard
  arrow-key repeats.
- **Accept:** store tests — one 3-second simulated drag = one undo step; a
  preset click followed 100 ms later by a taper toggle = two steps; a share
  link open = one step (now guaranteed, not timing-dependent).

### 10. Centralize interaction feedback
`tapFeedback`/`selectFeedback` calls are sprinkled through five components, and
sound cannot be turned off.
- **Change:** keep `feedback.ts` as the engine; add a `muted` flag persisted in
  localStorage and a small speaker toggle (header or /webmcp page); route the
  per-control calls through one `feedback(kind)` entry so policy lives in one
  file. *(behavior: adds a mute control)*
- **Accept:** muting stops both blips and vibration app-wide; preference
  survives reload; existing feedback e2e-style check still counts 6 events for
  the 7-click script when unmuted.

---

## P2 — performance (measured, not speculative)

### 11. Lazy-load `WebMCPPage`
The main shell chunk (466 KB / 145 KB gz) bundles the explainer page most
visitors never open.
- **Change:** `lazy(() => import("@/pages/WebMCPPage"))` behind the existing
  pathname check, with a minimal fallback.
- **Accept:** build output shows the shell chunk shrink and a separate
  `WebMCPPage` chunk; `/webmcp` e2e checks stay green.

### 12. Drop jsPDF's unused `html()` dependencies
`html2canvas` (199 KB) and `dompurify` chunks ship only because jsPDF's
`.html()` feature imports them; the app never calls it.
- **Change:** alias both to an empty module in `vite.config` (documented with a
  one-line comment), or switch to jsPDF's modular build if cleaner.
- **Accept:** `dist/` no longer contains html2canvas/purify chunks; the export
  e2e check still produces a valid multi-page PDF.

### 13. Take React out of the measurement fade loop
`useMeasurementCycler` calls `setState` per animation frame during each 700 ms
fade (forever, on the mobile thumbnail), re-rendering the R3F tree; and
`measureEntries` is rebuilt with fresh identities on every `Scene` render, so
drei `Line` geometries rebuild more often than needed.
- **Change:** drive the fade opacity via refs inside `useFrame` (React renders
  only on index *steps*); memoize `measureEntries` on
  `[form, wallThicknessMm, unit]`.
- **Accept:** with the thumbnail in cycle mode, React devtools profiler shows
  no re-renders during a fade; visual behavior unchanged (fade timing, ping-
  pong order).

### 14. Narrow the persistence/URL-sync subscriptions
Both subscribers wake on every store change, including `lastAgentCall`
churn from tool calls, then debounce away the no-ops.
- **Change:** use zustand's `subscribeWithSelector` middleware and subscribe to
  `(form, clay, paperSize, unit)` with shallow equality. **Land this in the
  same commit as item 6** — both touch the store's `create()` call, and doing
  them separately churns the same lines twice.
- **Accept:** a `recordAgentCall` no longer schedules a persistence write
  (assert via a spy in a store test); persistence/URL behavior otherwise
  unchanged.

### 15. Pause the WebMCP heartbeat in hidden tabs
The never-give-up watcher polls every 3 s forever, even hidden. Focus/visibility
listeners already re-check on return.
- **Change:** skip (or suspend) the interval while `document.hidden`; keep the
  immediate re-check on `visibilitychange`.
- **Accept:** late-injection e2e check still passes; a hidden-tab interval no
  longer fires (unit-testable by stubbing `document.hidden` if cheap, else code
  review suffices).

### 16. Throttle-awareness note for geometry rebuilds *(documentation only)*
Slider drags rebuild the lathe geometry per step (~60 Hz); r3f disposes
correctly so it's churn, not a leak, and currently smooth.
- **Change:** add a short comment at the `useMemo` in `Viewport.tsx` naming
  this as the first place to throttle if low-end devices stutter. No code
  change now — don't optimize without a measurement.

---

## P3 — resilience polish (nice before the deadline, fine after)

### 17. Error boundary around the 3D preview
A WebGL context loss or three.js exception currently unmounts the whole shell.
- **Change:** wrap the lazy `<Viewport>` in a small error boundary that renders
  the existing kiln-loader visual plus a "preview unavailable — your design and
  templates still work" line; log to console.
- **Accept:** forcing a throw inside `Scene` in dev leaves params + template
  panel + export fully functional.

---

## Sequencing

The demo video and the Devpost submission share these same days — the refactor
never outranks them. Work in tiers and stop at any tier boundary with a clean
repo:

1. **Tier A (high value, low risk — do these):** all of P0, then items 5, 7,
   11, 12. These are what a code reviewer sees first: boundaries, no duplicated
   contracts, smaller shell — and none of them change behavior.
2. **Tier B (worthwhile, more churn):** items 6+14 (one commit), 8, 10, 13,
   15, 17 — each independent; stop wherever the clock says stop.
3. **Tier C (only if everything above is done and green):** item 9. It is the
   riskiest behavior change on the list with the least reviewer-visible payoff;
   the current 800 ms coalescing is defensible as-is.
4. **Last day before submission:** final e2e + manual phone pass, delete this
   file, tag the submission commit.

## Explicitly out of scope

- Any new user-facing feature (curved profiles, trays, lids, landscape paper).
- Swapping libraries (zustand, zod, jsPDF, drei stay).
- Visual redesigns — the UI is done; only structure and performance move.
- Rewriting tests that pass; tests only change where a contract they pinned
  was itself the finding (e.g. item 2).

## Done

All 16 work items landed 2026-08-30, one commit each (6+14 combined by
design), every one behind the full lint / test / build / e2e gate:

| Item | Commit |
|---|---|
| 1 — unit-aware warnings in describeTemplates | `f984ef3` |
| 2 — shareUrl options object | `40d36cd` |
| 3 — PdfModule derived from the real module | `411d51c` |
| 4 — single source for the deployed origin | `44dba1d` |
| 5 — store module split by responsibility | `055e2e4` |
| 6+14 — store factory + design-slice subscriptions | `a32abef` |
| 7 — single source for the tool surface | `6ca0a24` |
| 8 — app shell decomposed | `b4f50e1` |
| 9 — commit-based undo coalescing | `8c75b88` |
| 10 — centralized feedback + mute switch | `ef4237f` |
| 11 — /webmcp lazy-loaded | `daea246` |
| 12 — jsPDF optional deps dropped (~380 kB) | `e4de05d` |
| 13 — React out of the measurement fade loop | `f5ad3aa` |
| 15 — heartbeat paused in hidden tabs | `b3437dd` |
| 16 — geometry-rebuild tradeoff documented | `22fd374` |
| 17 — error boundary around the 3D preview | `3f48501` |

Remaining: the final pre-submission commit deletes this file.
