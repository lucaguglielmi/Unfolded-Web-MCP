# Unfolded — WebMCP Tool Performance Specification

Status: **proposed** — nothing below has landed  
Baseline: `main` at `85e31b9` (`Merge pull request #7: phone pairing`), re-measured on this branch (docs-only ahead of it)  
Supersedes: the "renaming or merging the public tool names" non-goal of docs/webmcp-hardening-spec.md §2, for the four tools §4 names

## 1. Purpose

The potter wants two things to feel instant: what the agent does with the
tools, and what the agent says about the design. This review measured
where that time actually goes, and it is not in the page.

Measured on the production bundle with the repo's own bench (`npm run
perf`, sandbox Chromium) and a metadata probe against `buildTools()`:

| what | measured |
| --- | --- |
| read tools (`describe_project`, `get_template_summary`) | 0.4 ms p50 |
| mutations (`update_form`, `set_clay`, `set_capacity`, …) | 4–10 ms p50, 21 ms p95 — the bench's await also captures React's synchronous re-render and the three.js lathe rebuild |
| discovery metadata, 14 tools | 11,352 chars (~2,800 tokens), paid once per conversation |
| text result per state-reporting call | 1,480–1,700 B (~370–420 tokens), paid on every call |
| `get_preview_image` result | 7,378 B (~1,850 tokens) |
| shell JS chunk (gates time-to-tools) | 145 KB gzip; react-dom is over half of it |
| 3D chunk / PDF chunk, both lazy | 251 KB / 158 KB gzip |

Every page-side number is two to three orders of magnitude under one model
round trip. What an agent conversation actually pays is:

1. **round trips** — each tool call is a full host → page → host → model
   cycle, seconds each. Today a request that touches shape, clay, and
   units costs three sequential calls; every edit turn costs a second call
   for the link; and `describe_project` invites a read before the first
   edit whether or not the edit needs it;
2. **tokens per call** — every state result carries its snapshot twice
   (pretty-printed text plus compact `structuredContent`);
3. **time to tools** on a host that injects the API late — after the
   first 15 s the page looks for a host only every 3 s, and not at all
   while the document is hidden.

The metadata size is fine and stays guarded; the tool count matters only
through round trips. This spec removes round trips first, then bytes,
then the discovery gap. Where a decision trades performance against the
potter's flow, the flow wins.

## 2. Scope and non-goals

### In scope

- the public tool surface in `src/mcp/tools.ts` (names, descriptions,
  schemas) and its guards (`promptSuite.test.ts`, `structuredResult.test.ts`,
  `e2e/run.mjs`, `e2e/perf.mjs`, the `/webmcp` page and manifest, README);
- the result envelope's byte weight and the `tool-result` contract version;
- host discovery and registration timing in `useWebMCP.ts` / `register.ts`;
- the post-launch review notes for the handoff link (§8).

### Explicitly out of scope

- the link rule itself: every editing tool keeps routing links to
  `create_live_handoff` (decision recorded in §8);
- geometry, template vocabulary, share-link parameters, storage keys, PDF
  output, pairing protocol, Worker routes;
- the shell bundle (react-dom dominates it; the realistic savings, zod and
  tailwind-merge at ~30 KB gzip together, move time-to-tools by tens of
  milliseconds — not worth the churn);
- the 3D render loop, drag throttling, and `run_worker_first` narrowing —
  these belong with the deferred UI work in docs/performance-report.md,
  not with the agent path.

## 3. Delivery rules

- Work in the order of §11. Each numbered section is one reviewable
  commit; its tests land in the same commit.
- The prompt suite is the safety rail for every description change: a
  phrase the suite protects is cut only by changing the suite in the same
  commit, with the reason in the commit message.
- Every implementation commit passes:

  ```bash
  npm run lint
  npm test
  npm run build
  npm run e2e
  npm run perf
  ```

  and the commit message quotes the two numbers this spec is about: total
  metadata chars, and `describe_project` / `update_design` result bytes.
- Preserve everything §2 lists as out of scope. Result shapes change only
  where §5 says so, under a bumped contract version.
- If a host behaves differently from what a section assumes (ChatGPT
  discovery, Chrome registration), keep the production-proven behavior
  and record the compatibility decision in this file.

---

## 4. P0 — one mutation tool: `update_design`

### Finding

`update_form`, `set_clay`, `set_units` and `set_capacity` are four tools
that all end the same way (validate, patch the store, return the full
state). An agent asked *"make it a hexagonal planter, 18 cm tall, my clay
shrinks 13%, and show me inches"* has to make three sequential calls,
each a model round trip, before it can answer. Nothing in the page
requires the split: the store already applies a combined patch as one
undo step (`openModel(SharePatches)` is exactly form + clay + paperSize +
unit).

### Decision

One tool, `update_design`, replaces the four. `set_capacity` folds in as a
`capacityMl` field rather than staying a separate solver: the potter's
sentence usually carries the volume together with the shape and clay, and
the solve is well-defined only after those apply. Tool count goes from 14
to 11. Usability decides the edge cases below; where a choice was between
strictness and letting the call succeed, the call succeeds and the message
explains.

### Contract

- **name** `update_design`, title "Update the design", no `readOnlyHint`.
- **input schema** — one object, every field optional, derived with
  `z.toJSONSchema` from the existing schemas so property descriptions stay
  single-sourced:
  - the seven `formParamsSchema` fields (`type`, `tapered`, `name`,
    `heightMm`, `topDiameterMm`, `bottomDiameterMm`, `facets`);
  - the two `claySettingsSchema` fields (`shrinkagePct`, `wallThicknessMm`);
  - `units`: `'cm' | 'in'` — display only, described exactly as
    `set_units` describes it today ("changes every human-facing
    measurement … tool inputs and outputs stay in millimeters regardless");
  - `paperSize`: `'A4' | 'A3' | 'Letter'`;
  - `capacityMl`: number, 1–200 000 — "target fired interior capacity in
    milliliters; volume is linear in height, so the exact height is solved
    in this call — never iterate heightMm".
- **rules**
  - `heightMm` and `capacityMl` together is a validation error naming both
    fields, with the unchanged state (the existing `stateError` shape).
  - Legacy `type` values `cylinder` and `tapered` stay accepted
    (`normalizeLegacyFormPatch` already runs in `applyFormPatch`).
  - Order of application, inside one undo scope: form → clay →
    paperSize → units → capacity solve. The solve uses the diameters and
    clay *after* the other fields applied, so "hex planter 14 cm wide
    holding 1.2 L" is one exact call. Clamping keeps `set_capacity`'s
    current message ("Target … needs a … mm height — clamped to …").
  - An empty patch is not an error: `ok: true`, message "No changes
    requested.", full state.
  - A patch that changes nothing (same values) burns no undo step —
    the store already guarantees this per slice.
- **description** (≈ 700 chars; must keep every phrase §9 lists):

  > Change any subset of the design in ONE call: shape (type
  > round/faceted, the independent tapered flag, facets, name), fired
  > dimensions in millimeters (heightMm, topDiameterMm, bottomDiameterMm),
  > clay (shrinkagePct, wallThicknessMm), paperSize, and the potter's
  > display units ('cm' or 'in' — display only; tool inputs and outputs
  > stay in millimeters regardless). For a target volume pass capacityMl
  > (milliliters) instead of heightMm: volume is linear in height, so this
  > solves the exact height — never iterate. Everything applies together
  > as one undo step and the potter's 3D preview updates immediately.
  > Returns the full new state including capacityMl.
  > + LINK_RULE

- **result** — `stateResult("Design updated.")`, with the capacity note
  appended when `capacityMl` was given and the units note ("Display units
  set to inches.") when `units` changed. `structuredContent` is
  `{ ok, message, state, warnings? }` like every state-reporting tool.

### Retirements

`update_form`, `set_clay`, `set_units`, `set_capacity` are removed from
`buildTools()` and `TOOL_SUMMARIES`. No aliases: tools re-register on
every page load, so there is no installed base to break, and a retired
name in the registry would be dead metadata paid on every conversation.
The README's "solver, not just setters" paragraph moves to describing the
`capacityMl` field.

### Expected effect

- The three-attribute example above: 3 round trips → 1.
- "Make it hold 350 ml": unchanged, 1 call.
- Discovery metadata: the four tools weigh 4,453 chars today; the merged
  tool is estimated at ~3,200 (its schema is the union). Net ≈ −1,200
  chars, about 300 tokens per conversation. The budget in §9 moves down
  to lock it in.

### Touchpoints

`src/mcp/tools.ts` (tool + `TOOL_SUMMARIES`), `src/mcp/promptSuite.test.ts`,
`src/mcp/structuredResult.test.ts`, `src/mcp/tools.test.ts`,
`src/mcp/liveHandoff.test.ts`, `e2e/run.mjs` (`EXPECTED_TOOLS` — hand-edited,
by design), `e2e/perf.mjs` (cases), `e2e/pairing.mjs` (tool names),
`src/pages/agentManifest.ts` (`resultContract.shapes`, `invariants`),
`src/pages/WebMCPPage.tsx` (prompts; count derives from `TOOL_SUMMARIES`),
`src/pages/WhyPage.tsx`, README (tool table, prompts, "14 tools"),
docs/webmcp-hardening-spec.md (amendment note: merging now authorized by
this spec), docs/performance-report.md (§1 re-measured).

---

## 5. P0 — lighter results under contract `tool-result/2`

### Finding

A state result today is the snapshot twice: 673 B pretty-printed in the
text content plus 603 B compact in `structuredContent`, 1,436 B on the
wire for `describe_project`. Two of the snapshot's fields are constants
(`linkMode: "independent-copy"`, `liveHandoffTool: "create_live_handoff"`)
that say the same thing on every call.

### Decision

Keep both halves — the text half is the one path verified in ChatGPT and
retiring it is a post-launch item (§8) — but stop paying for
pretty-printing and for constants:

1. **Compact JSON in the text half.** `stateText` serializes with
   `JSON.stringify(state)` — no indentation. Same for
   `get_template_summary` and `create_live_handoff` text. A model reads
   compact JSON as well as pretty JSON; a human debugging in the console
   has `structuredContent`.
2. **Drop `linkMode` and `liveHandoffTool` from `describeState()`.** Their
   meaning already lives where the model reads it once: `describe_project`'s
   description ("a permanent link … otherwise links come from
   create_live_handoff") and the manifest's invariants. Nothing else in
   the snapshot is constant; `warnings: []` stays so the shape is stable.
3. **Bump `TOOL_RESULT_CONTRACT` to `tool-result/2`.** Removing fields is
   a shape change by the constant's own rule. The manifest's
   `resultContract` and docs/performance-report.md §7 follow.

### Expected effect

Measured today → expected: `describe_project` state 555 B compact; minus
the two constants ≈ 470 B; text half 673 → ≈ 470 B. Envelope ≈ 1,436 →
≈ 1,150 B, about 20% per call on every state-reporting call. The
remaining duplication (another ~40%) is §8's post-launch item.

### Guards to update

`structuredResult.test.ts` (its "state deep-equals the text's JSON"
invariant still holds — parsing is indentation-blind — but its byte table
and the pretty-vs-compact wording change), `liveHandoff.test.ts` (asserts
the two constants), `e2e/run.mjs` (checks `desc.liveHandoffTool`),
docs/live-handoff-link-spec.md's snapshot example, the manifest strings.

---

## 6. P0 — `describe_project` stops asking to be called first

### Finding

The description says "Call this first to see what the potter is working
on." An agent takes that literally: a read round trip before the first
edit, even for *"make it 12 cm tall"*, whose edit returns the same
snapshot anyway. The prompt suite pins the phrase ("call this first").

### Decision

Say when a read is worth it, and when it is not. Replace the sentence with:

> Read it when the request depends on what is there now — "what am I
> designing?", "make it taller", "will this print on one page?". An
> absolute edit ("make it 12 cm tall") can go straight to update_design,
> which returns this same snapshot.

Everything else in the description stays, including the live-sync
"look again and retry" paragraph. The prompt suite's `describe_project`
entry swaps "call this first" for "what am i designing" and "depends on
what is there now", and gains a negative assertion: the description must
not contain "call this first". A new suite entry, *"Make it 12 cm
tall."* → `update_design`, documents the intended routing.

---

## 7. P0 — host discovery: no 3-second gap, no hidden blind spot, parallel registration

### Finding

`useWebMCP` polls for a host every 500 ms for 15 s, then every 3 s
forever, and skips the poll entirely while `document.hidden`. The file's
own comment says the host that matters most (ChatGPT's in-app browser)
"may inject document.modelContext only when the person first engages the
agent — possibly minutes in". That is exactly when the poll is slow: up
to 3 s (1.5 s average) between injection and tools, and never if the
agent browser reports itself hidden and no focus/visibility event
arrives. Registration is also 14 sequential `await registerTool` calls;
on a host where registration is a real round trip that is 14× the
latency of one.

### Decision

The best fix is the plain one. An accessor trap on
`document.modelContext` was considered and rejected: Chrome defines the
attribute on `Document.prototype`, so an own-property accessor on the
instance would shadow the native getter — a risk on the one path that
works, for a sub-500 ms gain.

1. **Poll at 500 ms for the life of the tab while visible.** Drop the
   15 s window and `SLOW_POLL_MS` for visible documents. Cost is three
   property reads per tick; in the steady state `attempt()` is an
   identity check.
2. **Keep polling while hidden, at 3 s.** Browsers already throttle hidden
   timers (to once a minute after five minutes in Chrome), so the page
   pays nothing extra, and an agent browser that is never "visible" still
   registers. The immediate re-check on `visibilitychange` and `focus`
   stays.
3. **Register in parallel.** `registerToolSet` issues every `registerTool`
   call synchronously in order (hosts that list tools by registration
   order keep the order), then awaits `Promise.all`. Any rejection aborts
   the controller — all-or-nothing is unchanged, and a current-draft host
   removes the partial set on the signal exactly as today. The legacy
   `provideContext` branch is untouched.
4. **Measure it on the real host.** The profiler's ledger already records
   `hostFoundAt` and `firstRegistrationAt`. The manual validation matrix
   (§10) gains a row: open the app with `?perf=1` in ChatGPT's browser,
   engage the agent minutes later, read `__webmcpPerf.report()`; the gap
   between the two timestamps must be under 600 ms.

### Tests

`register.test.ts`: a fake host that resolves each registration after
20 ms completes 14 tools in one delay, not fourteen; a fake that rejects
the seventh still aborts the controller and leaves no tool registered;
abort before the set starts registers nothing. `useWebMCP`'s poll
constants are exported for a test that advances fake timers past 15 s
and asserts the interval did not change.

---

## 8. Deferred to after public launch — the second call per edit turn

### Finding

Every editing tool tells the agent to call `create_live_handoff` before
replying, so an edit turn is two round trips, and the second is the only
network-bound tool (WebSocket connect on first use, then a
SessionDO → PairingDO hop per mint).

### Decision

**Keep the rule as it is for launch.** The handoff contract
(docs/live-handoff-link-spec.md) is the product's core promise — a link
that continues the live session, minted fresh, never substituted — and
it was written to end a real incident. Snapshots stay pure; no token is
minted by a read or an edit. The second round trip is the price of the
promise until measurement says otherwise.

### Review after launch — what to measure and what would change

Collect from real ChatGPT sessions with `?perf=1`, over at least a week:

- `create_live_handoff` `wallMs` p50/p95, split by first call in a tab
  (cold socket) versus later calls (warm socket);
- `gapSincePrevCallMs` before and after `create_live_handoff` — the
  host/model time the second round trip actually adds to the turn;
- how often the potter opens the link at all (the Worker's claim counts).

If the second round trip is what the potter waits for, the candidate
change is: **state results carry a fresh `liveHandoffUrl` when the tab is
already paired**, and the link rule becomes "return the liveHandoffUrl
from the result". Trade-offs to weigh then, not now: it spends a
single-use token per edit (a PairingDO write each; unused tokens expire
in 15 minutes), it breaks the "snapshots never spend a token" invariant
the manifest states, and every result's link is distinct — the agent
must return the newest. An unpaired tab would still need the explicit
call, so the two-path behavior must be described without confusing the
routing the prompt suite protects.

Also on the same review: **retire the text half of results** once
`structuredContent` is verified in ChatGPT's browser and Chrome
(docs/webmcp-hardening-spec.md §9.3's original plan) — that is where the
other ~40% of per-call bytes goes.

---

## 9. Guards: prompt suite, budget, contract tests

- **Prompt suite rewrite.** Four entries retarget to `update_design`:
  *"Make it hold about 350 ml."* (must mention "milliliters", "solves the
  exact height"), *"My stoneware shrinks 13% — adjust my templates."*
  ("shrinkage"), *"Make it a hexagonal planter, 18 cm tall."* ("hexagon",
  "fired", "millimeters"), *"Switch to inches."* ("display", "millimeters
  regardless"). `describe_project`'s entry changes per §6. New: *"Make it
  12 cm tall."* → `update_design`. The "every editing tool carries the
  link rule" and "promises the full state" assertions list the new name.
  The `update_form`-defers-to-`set_capacity` assertion becomes:
  `update_design`'s metadata contains "never iterate".
- **Metadata budget.** Lower `METADATA_BUDGET_CHARS` to the measured
  total after §4 plus 5% (expected ≈ 10,500). The floor stays at 6,000.
- **Structured-result contract.** `structuredResult.test.ts` iterates the
  11 tools, asserts `TOOL_RESULT_CONTRACT === "tool-result/2"`, and its
  byte table prints compact text bytes — that printout is the number the
  commit message quotes.
- **e2e.** `EXPECTED_TOOLS` is edited by hand to the 11 names (the
  independent contract check stays independent). The `set_capacity` case
  becomes `update_design({ capacityMl: 500 })`; a new case sends form +
  clay + units in one call and asserts all three landed and one undo
  reverts all of them. The `liveHandoffTool` assertion goes.
- **Bench.** `e2e/perf.mjs` cases: `update_design` (height), `update_design`
  (type flip), `update_design` (clay), `update_design` (capacity),
  `update_design` (units), plus a combined form+clay+units case.

## 10. Documentation and manual validation

- README: tool table (11 rows), the three example prompts, every "14
  tools" → "11", the solver paragraph.
- `/webmcp` page: prompts; the count word derives from `TOOL_SUMMARIES`
  already.
- docs/performance-report.md: §1 and §7 re-measured after §4–§5; note the
  contract bump.
- docs/webmcp-hardening-spec.md: amendment note pointing here for the
  merge and for the 11-tool count in its validation matrix.
- docs/live-handoff-link-spec.md: the snapshot example loses the two
  constants; §8 of this spec is referenced from its post-launch notes.
- Manual validation matrix additions:

| Environment | Added check |
| --- | --- |
| ChatGPT built-in browser | all 11 tools discovered; *"hex planter, 18 cm, 13% shrinkage, inches"* lands as ONE `update_design` call; *"make it 12 cm tall"* does not trigger `describe_project` first |
| ChatGPT built-in browser, `?perf=1` | `hostFoundAt` → `firstRegistrationAt` under 600 ms when the agent is engaged minutes after load |
| Chrome with WebMCP flag | 11 tools in the inspector in registration order; a mid-set registration failure leaves the registry empty |

## 11. Implementation order and stop rules

1. §7 — discovery and parallel registration (no public-surface change;
   ships alone, first).
2. §4 — `update_design`, with §9's suite, budget, e2e and bench changes in
   the same commit.
3. §6 — `describe_project` wording, with its suite entries.
4. §5 — compact text, constants dropped, `tool-result/2`, docs.
5. §10 — README and page copy; re-run `npm run perf` and update the
   report.
6. Manual matrix on ChatGPT and Chrome. Record the versions.

Stop and keep the last green commit if ChatGPT stops discovering the
full set, if the prompt suite needs a protected phrase cut to fit the
budget (raise the budget in the same commit and say why instead), or if
the combined call lands as separate calls in ChatGPT — that would mean
the description, not the tool, needs work.

## 12. Definition of done

- 11 tools register, in order, all-or-nothing, on a fake host that
  resolves each registration late; total registration time is one delay.
- The host poll is 500 ms while visible and 3 s while hidden, for the
  life of the tab; the profiler ledger on a real ChatGPT session shows
  the discovery gap under 600 ms.
- *"Hexagonal planter, 18 cm tall, 13% shrinkage, in inches"* is one call
  and one undo step; *"make it hold 350 ml"* is one call; both return the
  full state.
- `describe_project` no longer says "call this first"; the suite asserts it.
- Discovery metadata is under the lowered budget; `describe_project`'s
  envelope is under 1,200 B; both numbers are in the commit messages and
  in docs/performance-report.md.
- `TOOL_RESULT_CONTRACT` is `tool-result/2` and the manifest, tests and
  report agree.
- §8's review notes are linked from docs/live-handoff-link-spec.md.

## 13. Traceability — review finding → section

| finding | section |
| --- | --- |
| three sequential calls for one potter sentence | §4 |
| second round trip per edit turn (link rule) | §8 (kept; review after launch) |
| snapshot carried twice, pretty-printed, with two constants | §5 |
| "Call this first" induces a read before absolute edits | §6 |
| 3 s host poll after 15 s; no poll while hidden; sequential registration | §7 |
| metadata size, boot, 3D/PDF chunks, preview payload | healthy — §2 non-goals |

## 14. References

- docs/performance-report.md — the audit this spec re-measures
- docs/webmcp-hardening-spec.md §9 — the metadata trim and the structured-result decision
- docs/live-handoff-link-spec.md — the link contract §8 preserves
- docs/webmcp-profiler-spec.md — the ledger fields §7 measures with
- WebMCP Draft Community Group Report: <https://webmachinelearning.github.io/webmcp/>
