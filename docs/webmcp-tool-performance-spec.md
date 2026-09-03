# Unfolded — WebMCP Tool Performance Specification

Status: **landed** — §4, §5, §6, §7 and §8 are built; §9 is the post-launch review it always was  
Baseline: `main` at `09afed1` (the code-smell review merge, after the schema-weight trim `3c2fe5c`); measured results in docs/performance-report.md §1.3

**Changes since first draft.** Re-based on the schema-weight trim and
profiler 0.2: the metadata figures, the merged tool's estimate, the
`describe_project` sentence and the budget numbers are the new ones;
the discovery-gap measurement (§7) reads the ledger through
`get_perf_report` instead of the console; §4 carries the legacy-`type`
enum rule the trim commit introduced. New §8: fingerprinted assets are
served without browser caching in production — found by reading the
live headers, the cheapest item here, so it goes first in the order.
§6 gains the fresh-session offer: a potter who starts in ChatGPT was
offered only the pairing-code way in, never the link that opens a
paired browser session with the chat (§6.2, from a live session).
The pre-launch rule that public tool names are never renamed or merged
is superseded for the four tools §4 names.

## 1. Purpose

The potter wants two things to feel instant: what the agent does with the
tools, and what the agent says about the design. This review measured
where that time actually goes, and it is not in the page.

Measured on the production bundle with the repo's bench (`npm run perf`,
sandbox Chromium through the profiler's fake host), a metadata probe
against `buildTools()`, and the native-host runner
(docs/performance-report.md §1.2):

| what | measured |
| --- | --- |
| read tools (`describe_project`, `get_template_summary`) | 0.5 ms p50 |
| mutations (`update_form`, `set_clay`, `set_capacity`, …) | 3–4 ms p50, ≤ 10 ms p95 — the bench's await also captures React's synchronous re-render and the three.js lathe rebuild |
| Chrome 152 native host, per invocation | ~280 ms flat, whatever the tool (docs/performance-report.md §1.2) |
| discovery metadata, 14 tools | 9,029 chars (~2,260 tokens) after the trim; budget test at 9,500 |
| text result per state-reporting call | 1,438 B for `describe_project` (674 B text + 556 B compact `state`), ~360 tokens, on every call |
| `get_preview_image` result | 7,378 B (~1,850 tokens) |
| shell JS (gates time-to-tools) | ~151 KB gzip across two chunks; react-dom is over half |
| 3D chunk / PDF chunk, both lazy | 251 KB / 158 KB gzip |
| fingerprinted assets in production | `Cache-Control: public, max-age=0, must-revalidate` — revalidated on every load |

Every page-side number is two to three orders of magnitude under one model
round trip, and the host itself adds ~280 ms per call before the model's
own turn. What an agent conversation actually pays is:

1. **round trips** — each tool call is a full host → page → host → model
   cycle. Today a request that touches shape, clay, and units costs three
   sequential calls; every edit turn costs a second call for the link;
   and `describe_project` still says "Call this first" whether or not
   the first edit needs a read;
2. **tokens per call** — every state result carries its snapshot twice
   (pretty-printed text plus compact `structuredContent`);
3. **time to tools** on a host that injects the API late — after the
   first 15 s the page looks for a host only every 3 s, and not at all
   while the document is hidden;
4. **bytes re-fetched** — every fresh tab (each ChatGPT agent-browser
   session included) revalidates the shell, the 3D chunk and the PDF
   chunk with the edge before using them, though their names are hashes.

The metadata size is fine and stays guarded; the tool count matters only
through round trips. This spec removes the cache misses first because
they cost one file, then round trips, then bytes, then the discovery
gap. Where a decision trades performance against the potter's flow, the
flow wins.

## 2. Scope and non-goals

### In scope

- the public tool surface in `src/mcp/tools.ts` (names, descriptions,
  schemas) and its guards (`promptSuite.test.ts`, `structuredResult.test.ts`,
  `tools.test.ts`, `docsGuard.test.ts`, `e2e/run.mjs`, `e2e/perf.cases.json`,
  the `/webmcp` page and manifest, README);
- the result envelope's byte weight and the `tool-result` contract version;
- host discovery and registration timing in `useWebMCP.ts` / `register.ts`;
- browser cache policy for the fingerprinted build output;
- the post-launch review notes for the handoff link (§9).

### Explicitly out of scope

- the link rule itself: every editing tool keeps routing links to
  `create_live_handoff` (decision recorded in §9);
- further description trims: the schema-weight trim landed; what is left
  in the descriptors is the bounds and the routing sentences the prompt
  suite protects;
- geometry, template vocabulary, share-link parameters, storage keys, PDF
  output, pairing protocol, Worker routes;
- the shell bundle (react-dom dominates it; the realistic savings, zod and
  tailwind-merge at ~30 KB gzip together, move time-to-tools by tens of
  milliseconds — not worth the churn);
- the 3D render loop, drag throttling, and `run_worker_first` narrowing —
  these belong with the deferred UI work in docs/performance-report.md,
  not with the agent path.

## 3. Delivery rules

- Work in the order of §12. Each numbered section is one reviewable
  commit; its tests land in the same commit.
- The prompt suite is the safety rail for every description change: a
  phrase the suite protects is cut only by changing the suite in the same
  commit, with the reason in the commit message.
- Every implementation commit passes the gate in AGENTS.md plus the bench:

  ```bash
  npm run lint
  npm test
  npm run build
  npm run e2e
  npm run perf
  ```

  and the commit message quotes the two numbers this spec is about: total
  metadata chars (the budget test prints it), and `describe_project` /
  `update_design` result bytes (`structuredResult.test.ts` prints them).
- Preserve everything §2 lists as out of scope. Result shapes change only
  where §5 says so, under a bumped contract version.
- If a host behaves differently from what a section assumes (ChatGPT
  discovery, Chrome registration), keep the production-proven behavior
  and record the compatibility decision in the "Changes since first
  draft" paragraph.

---

## 4. P0 — one mutation tool: `update_design`

### Problem

`update_form`, `set_clay`, `set_units` and `set_capacity` are four tools
that all end the same way (validate, patch the store, return the full
state). An agent asked *"make it a hexagonal planter, 18 cm tall, my clay
shrinks 13%, and show me inches"* has to make three sequential calls,
each ~280 ms of host plumbing plus a model turn, before it can answer.
Nothing in the page requires the split: the store already applies a
combined patch as one undo step (`openModel(SharePatches)` is exactly
form + clay + paperSize + unit).

### Change

One tool, `update_design`, replaces the four. `set_capacity` folds in as a
`capacityMl` field rather than staying a separate solver: the potter's
sentence usually carries the volume together with the shape and clay, and
the solve is well-defined only after those apply. The surface goes from
14 tools to 11, plus `get_perf_report` while profiling is armed, as
today. Usability decides the edge cases below; where a choice was
between strictness and letting the call succeed, the call succeeds and
the message explains.

- **name** `update_design`, title "Update the design", no `readOnlyHint`.
- **input schema** — one zod object declared once and used for both the
  advertised JSON Schema and the call's validation (the rule the trim
  commit set: what is advertised is exactly what is accepted). Every
  field optional:
  - the seven form fields from `updateFormToolInputSchema` — including
    its `type` enum with the legacy `cylinder` / `tapered` values, which
    `tools.test.ts` pins today for `update_form` and pins for
    `update_design` after;
  - the two `claySettingsSchema` fields (`shrinkagePct`, `wallThicknessMm`);
  - `units`: `'cm' | 'in'`;
  - `paperSize`: `'A4' | 'A3' | 'Letter'`;
  - `capacityMl`: number, 1–200 000, described as "target capacity in
    ml, e.g. 350 for a mug; solved exactly in this call instead of
    heightMm — never iterate".
- **rules**
  - `heightMm` and `capacityMl` together is a validation error naming both
    fields, with the unchanged state (the existing `stateError` shape).
  - Order of application, inside one undo scope: form → clay →
    paperSize → units → capacity solve. The solve uses the diameters and
    clay *after* the other fields applied, so "hex planter 14 cm wide
    holding 1.2 L" is one exact call. Clamping keeps `set_capacity`'s
    current message ("Target … needs a … mm height — clamped to …").
  - An empty patch is not an error: `ok: true`, message "No changes
    requested.", full state.
  - A patch that changes nothing burns no undo step — the store already
    guarantees this per slice.
- **description** (≈ 600 chars; must keep every phrase §10 lists):

  > Change any subset of the design in ONE call: shape (type, tapered,
  > facets, name), the dimensions in FIRED millimeters, clay (shrinkage
  > and wet slab thickness), paperSize, and the potter's display units
  > ('cm' or 'in' — display only; tool inputs and outputs stay in
  > millimeters regardless). For a target volume pass capacityMl
  > (milliliters) instead of heightMm: volume is linear in height, so
  > this solves the exact height — never iterate. Everything applies
  > together as one undo step and the potter's 3D preview updates at
  > once. Returns the full new state with capacityMl.
  > + LINK_RULE

- **result** — `stateResult("Design updated.")`, with the capacity note
  appended when `capacityMl` was given and the units note ("Display units
  set to inches.") when `units` changed. `structuredContent` is
  `{ ok, message, state, warnings? }` like every state-reporting tool.
- **retirements** — `update_form`, `set_clay`, `set_units`,
  `set_capacity` leave `buildTools()` and `TOOL_SUMMARIES`. No aliases:
  tools re-register on every page load, so there is no installed base to
  break, and a retired name in the registry would be dead metadata paid
  on every conversation.

### Acceptance

- *"Hexagonal planter, 18 cm tall, 13% shrinkage, in inches"* lands as
  one `update_design` call and one undo step in the e2e suite and in the
  ChatGPT manual check (§11).
- *"Make it hold 350 ml"* stays one call.
- Discovery metadata falls: the four tools weigh 3,526 chars today
  (1,671 + 668 + 512 + 675); the merged tool is estimated at ~2,700 (its
  schema is the union, ~1,900, plus the description). Net ≈ −800 chars,
  ~200 tokens per conversation; the budget in §10 moves down to lock it in.

### App-side work

`src/mcp/tools.ts` (tool + `TOOL_SUMMARIES`; the `conditional` flag on
`get_perf_report` is untouched), `src/lib/model/schemas.ts` (the merged
input schema next to `updateFormToolInputSchema`),
`src/mcp/promptSuite.test.ts`, `src/mcp/structuredResult.test.ts`,
`src/mcp/tools.test.ts` (legacy-enum test retargets), `src/mcp/liveHandoff.test.ts`,
`e2e/run.mjs` (`EXPECTED_TOOLS` — hand-edited, by design), `e2e/perf.cases.json`
(cases), `e2e/pairing.mjs`, `e2e/native-host.mjs` (its session script),
`src/pages/agentManifest.ts` (`resultContract.shapes`, `invariants`),
`src/pages/WebMCPPage.tsx` (prompts; the count derives from `TOOL_SUMMARIES`),
`src/pages/WhyPage.tsx`, `src/pages/UserFlowPage.tsx` ("all 14 tools"),
README (tool table — `docsGuard.test.ts` checks it against `TOOL_SUMMARIES`
name-for-name — plus the prompts, "Fourteen tools", "all 14 tools", and
the solver paragraph), docs/performance-report.md (§1 re-measured).

---

## 5. P0 — lighter results under contract `tool-result/2`

### Problem

A state result today is the snapshot twice: 674 B pretty-printed in the
text content plus 556 B compact in `structuredContent`, 1,438 B on the
wire for `describe_project`. Two of the snapshot's fields are constants
(`linkMode: "independent-copy"`, `liveHandoffTool: "create_live_handoff"`)
that say the same thing on every call.

### Change

Keep both halves — the text half is the one path verified in ChatGPT and
retiring it is a post-launch item (§9) — but stop paying for
pretty-printing and for constants:

1. **Compact JSON in the text half.** `stateText` serializes with
   `JSON.stringify(state)` — no indentation. Same for
   `get_template_summary` and `create_live_handoff` text. A model reads
   compact JSON as well as pretty JSON; a human debugging in the console
   has `structuredContent`.
2. **Drop `linkMode` and `liveHandoffTool` from `describeState()`.** Their
   meaning already lives where the model reads it once: `describe_project`'s
   description ("given out only when the potter explicitly asks … otherwise
   links come from create_live_handoff") and the manifest's invariants.
   Nothing else in the snapshot is constant; `warnings: []` stays so the
   shape is stable. §6.2's `session` field is the one addition under the
   same contract bump.
3. **Bump `TOOL_RESULT_CONTRACT` to `tool-result/2`.** Removing fields is
   a shape change by the constant's own rule. The manifest's
   `resultContract` and docs/performance-report.md §7 follow.

### Acceptance

`describe_project`'s text half ≈ 500 B (556 B compact today minus the two
constants, plus `session`), the envelope ≈ 1,200 B, about 17% under
today's 1,438 B —
printed by `structuredResult.test.ts` and quoted in the commit. The
remaining duplication (another ~40%) is §9's post-launch item.

### App-side work

`src/mcp/tools.ts` (`stateText`), `src/mcp/describe.ts`,
`src/mcp/modelContext.ts` (the constant), `structuredResult.test.ts`
(its "state deep-equals the text's JSON" invariant still holds — parsing
is indentation-blind — but its byte table and wording change),
`liveHandoff.test.ts` (asserts the two constants), `e2e/run.mjs` (checks
`desc.liveHandoffTool`), docs/live-handoff-link-spec.md's snapshot
example, the manifest strings, docs/performance-report.md §7.

---

## 6. P0 — `describe_project`: the routing sentence and the fresh-session offer

### 6.1 Stop asking to be called first

#### Problem

After the trim the description says, simply, "Call this first." An agent
takes that literally: a read round trip before the first edit, even for
*"make it 12 cm tall"*, whose edit returns the same snapshot anyway. The
prompt suite pins the phrase ("call this first").

#### Change

Say when a read is worth it, and when it is not. Replace the sentence with:

> Read it when the request depends on what is there now — "what am I
> designing?", "make it taller", "will this print on one page?", or when
> the potter has just connected; an absolute edit ("make it 12 cm tall")
> can go straight to update_design, which returns this same snapshot.

Everything else in the description stays, including the live-sync "look
again and retry" sentence. The prompt suite's `describe_project` entry
swaps "call this first" for "what am i designing" and "depends on what
is there now", and gains a negative assertion: the description must not
contain "call this first". A new suite entry, *"Make it 12 cm tall."* →
`update_design`, documents the intended routing.

#### Acceptance

In the ChatGPT manual check (§11), *"make it 12 cm tall"* on a fresh
conversation produces one `update_design` call and no `describe_project`
before it; *"what am I designing?"* still routes to `describe_project`.

### 6.2 A fresh session offers the paired-browser link

#### Problem

Seen live: a potter opens ChatGPT, says "Connect to tryunfolded.com",
and the agent reads the default design and replies *"This is a fresh
session. Send me the six-character pairing code if you want me to join
the design already open on your device."* That offers only the way in
that starts on a device the potter may not have open. The other way in
already exists — `create_live_handoff` mints a link that opens this
design in the potter's own browser, paired with the chat — but nothing
tells the agent to offer it on first contact, so the potter who starts
in ChatGPT never sees it. It is the more useful of the two for that
potter: one tap, and the chat and the screen are the same session.

The snapshot also gives the agent no way to know the session is fresh;
"fresh" was inferred from the default mug. That guess is wrong the
moment a potter has paired before.

#### Change

1. **The snapshot says whether the tab is paired.** `describeState()`
   gains `session: { paired: boolean, peers: number }` from
   `liveSync.isPaired()` / `liveSync.peers()` — a fact, not a guess, at
   ~30 bytes. Read-only: reading it never mints anything (§9's invariant
   holds). It lands under `tool-result/2` with §5.
2. **The description tells the agent what to offer when the session is
   fresh.** Appended to `describe_project`:

   > When session.paired is false, offer the potter both ways in, in
   > this order: (1) call create_live_handoff and give them its
   > liveHandoffUrl as a link labelled "Open a paired browser session
   > with this chat" — one tap opens this design on their screen,
   > paired with this conversation; (2) or, if they already have the
   > design open on another device, ask for its six-character code and
   > call join_session.

   The link call is one extra round trip on the potter's first turn,
   spent once; usability decides it. The rule keeps the handoff contract
   whole: the link is minted by `create_live_handoff`, fresh, returned
   verbatim, never by a read.
3. **One label for the mirror of "Open in ChatGPT".** The header's
   connection panel already names the browser → chat direction "Open in
   ChatGPT". "Open a paired browser session with this chat" is the
   chat → browser direction, introduced here; docs/user-flow.md's
   ChatGPT-first scenario and the `/user-flow` page gain that step under
   that label, so the two ends of the flow name each other consistently.

#### Acceptance

- `describeState()` carries `session`; `structuredResult.test.ts` asserts
  `session.paired === false` and `peers === 1` in the test environment,
  and `liveHandoff.test.ts` asserts a read still mints nothing.
- Prompt suite: *"Connect to tryunfolded.com"* → `describe_project`,
  must mention "paired browser session", "create_live_handoff" and
  "six-character".
- Manual (§11): a fresh ChatGPT conversation's first reply contains a
  tappable link labelled "Open a paired browser session with this chat"
  that opens the design paired with the chat (the sync dot goes green on
  both ends), and offers the code as the alternative. The link is the
  `liveHandoffUrl` of a `create_live_handoff` call made in that turn.

### App-side work

`src/mcp/tools.ts`, `src/mcp/describe.ts` (`session`),
`src/mcp/promptSuite.test.ts`, `src/mcp/structuredResult.test.ts`,
`src/mcp/liveHandoff.test.ts`, `src/pages/agentManifest.ts` (the state
shape in `resultContract` and `invariants`), `src/pages/UserFlowPage.tsx`
(the ChatGPT-first card gains the link step under the new label),
docs/user-flow.md (the ChatGPT-first scenario likewise),
docs/live-handoff-link-spec.md (the snapshot example gains `session`).

---

## 7. P0 — host discovery: no 3-second gap, no hidden blind spot, parallel registration

### Problem

`useWebMCP` polls for a host every 500 ms for 15 s, then every 3 s
forever, and skips the poll entirely while `document.hidden`. The file's
own comment says the host that matters most (ChatGPT's in-app browser)
"may inject document.modelContext only when the person first engages the
agent — possibly minutes in". That is exactly when the poll is slow: up
to 3 s (1.5 s average) between injection and tools, and never if the
agent browser reports itself hidden and no focus/visibility event
arrives. Registration is also 14 sequential `await registerTool` calls;
on a host where registration is a real round trip that is 14× the
latency of one. The README presents the pause in hidden tabs as a
feature ("a heartbeat paused in hidden tabs").

### Change

The best fix is the plain one. An accessor trap on
`document.modelContext` was considered and rejected: Chrome defines the
attribute on `Document.prototype` (the native-host runner confirms
`document.modelContext` is a platform object), so an own-property
accessor on the instance would shadow the native getter — a risk on the
one path that works, for a sub-500 ms gain.

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
4. **Measure it on the real host.** The profiler's ledger records
   `hostFoundAt` and `firstRegistrationAt`, and `get_perf_report` reads
   the ledger back through the host while profiling is armed. The manual
   validation matrix (§11) gains a row: open the app with `?perf=1` in
   ChatGPT's browser, engage the agent minutes later, ask it for
   `get_perf_report` with `view=summary`; the gap between the two
   timestamps must be under 600 ms.

### Acceptance

- `register.test.ts`: a fake host that resolves each registration after
  20 ms completes 14 tools in one delay, not fourteen; a fake that
  rejects the seventh still aborts the controller and leaves no tool
  registered; abort before the set starts registers nothing.
- `useWebMCP`'s poll constants are exported for a test that advances fake
  timers past 15 s and asserts the interval did not change, and that a
  hidden document still polls.
- The 600 ms gap on a real ChatGPT session, recorded in
  docs/performance-report.md.

### App-side work

`src/mcp/useWebMCP.ts`, `src/mcp/register.ts`, `src/mcp/register.test.ts`,
README (the "Never-give-up registration" bullet), docs/performance-report.md.

---

## 8. P0 — browser caching of fingerprinted assets

### Problem

Production serves every file under `/assets/` with the Workers
static-assets default, `Cache-Control: public, max-age=0,
must-revalidate` (read from the live headers at the baseline commit;
`cf-cache-status: HIT`, so the edge is fine — the browser is not). The
shell, the store chunk, the 3D chunk (251 KB gzip) and the PDF chunk are
therefore revalidated with the edge on every load — every return visit,
and every fresh tab ChatGPT's agent browser opens for a conversation —
before the cached bytes may be used. Vite fingerprints these files, so a
new build never reuses a name: they are immutable by construction.

### Change

Add `public/_headers`, which Vite copies into `dist/` and Workers static
assets honor:

```
/assets/*
  Cache-Control: public, max-age=31556952, immutable
```

The Worker's `withSecurityHeaders` sets only security headers, so the
directive passes through unchanged. `index.html` keeps the default
revalidate policy, which is what an HTML entry with hashed references
wants. Nothing under `public/` besides `/assets/*` changes: icons,
`theme-init.js` and the diagrams are not fingerprinted.

### Acceptance

- `npm run e2e:worker` (wrangler dev serves `_headers` too) gains a
  check: `/assets/<the built shell chunk>` returns `immutable`, `/` does not.
- `e2e/live.mjs` gains the same check against the deployment.
- A return visit in a browser with DevTools open shows the four chunks
  served from disk or memory cache with no conditional request.

### App-side work

`public/_headers`, `e2e/worker-smoke.mjs`, `e2e/live.mjs`,
docs/performance-report.md §2 (a line on repeat-visit bytes).

---

## 9. Deferred to after public launch — the second call per edit turn

### Problem

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

Collect from real ChatGPT sessions with `?perf=1`, over at least a week,
through `get_perf_report`:

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
`structuredContent` is verified in ChatGPT's browser and Chrome — the
plan docs/performance-report.md §7 records — that is where the other
~40% of per-call bytes goes.

---

## 10. Guards: prompt suite, budget, contract tests

- **Prompt suite rewrite.** Four entries retarget to `update_design`:
  *"Make it hold about 350 ml."* (must mention "milliliters", "solves the
  exact height"), *"My stoneware shrinks 13% — adjust my templates."*
  ("shrinkage"), *"Make it a hexagonal planter, 18 cm tall."* ("hexagon",
  "fired", "millimeters" — "hexagon" lives in the `facets` property
  description, which the merged schema keeps), *"Switch to inches."*
  ("display", "millimeters regardless"). `describe_project`'s entry
  changes per §6.1. New: *"Make it 12 cm tall."* → `update_design`, and
  *"Connect to tryunfolded.com"* → `describe_project` with §6.2's three
  phrases. The
  "every editing tool carries the link rule" and "promises the full
  state" assertions list the new name. The `update_form`-defers-to-
  `set_capacity` assertion becomes: `update_design`'s metadata contains
  "never iterate".
- **Metadata budget.** `METADATA_BUDGET_CHARS` is 9,500 today against
  9,029 measured. §6.2 adds ~350 chars to `describe_project` (fits the
  current budget); §4 removes ~800. After both, lower the budget to the
  measured total plus 5% (expected ≈ 9,000). The floor stays at 6,000.
- **Advertised equals accepted.** The `tools.test.ts` case that pins
  `update_form`'s `type` enum (`round, faceted, cylinder, tapered`)
  retargets to `update_design`; the merged input object is the one zod
  schema for both the JSON Schema and the parse.
- **Structured-result contract.** `structuredResult.test.ts` iterates the
  11 tools, asserts `TOOL_RESULT_CONTRACT === "tool-result/2"`, and its
  byte table prints compact text bytes — that printout is the number the
  commit message quotes.
- **e2e.** `EXPECTED_TOOLS` is edited by hand to the 11 names (the
  independent contract check stays independent). The `set_capacity` case
  becomes `update_design({ capacityMl: 500 })`; a new case sends form +
  clay + units in one call and asserts all three landed and one undo
  reverts all of them. The `liveHandoffTool` assertion goes.
  `e2e/native-host.mjs`'s session script uses the new name.
- **Bench.** `e2e/perf.cases.json`: `update_design` (height),
  `update_design` (type flip), `update_design` (clay), `update_design`
  (capacity), `update_design` (units), plus a combined form+clay+units
  case; `allowMutating` in `e2e/perf.mjs` follows.
- **Headers.** The `_headers` checks of §8 in `e2e/worker-smoke.mjs` and
  `e2e/live.mjs`.

## 11. Documentation and manual validation

- README: tool table (11 rows plus `get_perf_report`), the three example
  prompts, "Fourteen tools" and "all 14 tools" → eleven, the solver
  paragraph, the registration bullet (§7).
- `/webmcp`, `/why`, `/user-flow` pages: prompts and counts.
- docs/performance-report.md: §1 and §7 re-measured after §4–§5; §2 gains
  the repeat-visit line (§8); note the contract bump.
- docs/live-handoff-link-spec.md: the snapshot example loses the two
  constants; §9 of this spec is referenced from its post-launch notes.
- docs/README.md: this spec's status row moves from "design" to "partly
  built" as sections land, then "landed".
- Manual validation matrix additions:

| Environment | Added check |
| --- | --- |
| ChatGPT built-in browser | all 11 tools discovered; *"hex planter, 18 cm, 13% shrinkage, inches"* lands as ONE `update_design` call; *"make it 12 cm tall"* does not trigger `describe_project` first |
| ChatGPT, fresh conversation, phone | *"Connect to tryunfolded.com"*: the first reply offers a tappable "Open a paired browser session with this chat" link (a `liveHandoffUrl` minted in that turn) and the six-character code as the alternative; tapping the link opens the design paired with the chat |
| ChatGPT built-in browser, `?perf=1` | `get_perf_report` shows `hostFoundAt` → `firstRegistrationAt` under 600 ms when the agent is engaged minutes after load |
| Chrome 152+ with WebMCPTesting (`npm run live:native`) | 11 tools in registration order; the session script completes; a mid-set registration failure leaves the registry empty |
| Any browser, second visit | `/assets/*` served from cache with no conditional requests |

## 12. Implementation order and stop rules

1. §8 — `_headers` (one file, no behavior change; ships alone, first).
2. §7 — discovery and parallel registration (no public-surface change).
3. §4 — `update_design`, with §10's suite, budget, e2e and bench changes in
   the same commit.
4. §6 — `describe_project` wording and the fresh-session offer, with
   the `session` field and the suite entries.
5. §5 — compact text, constants dropped, `tool-result/2`, docs.
6. §11 — README and page copy; re-run `npm run perf` and update the
   report.
7. Manual matrix on ChatGPT and Chrome. Record the versions.

Stop and keep the last green commit if ChatGPT stops discovering the
full set, if the prompt suite needs a protected phrase cut to fit the
budget (raise the budget in the same commit and say why instead), or if
the combined call lands as separate calls in ChatGPT — that would mean
the description, not the tool, needs work.

## 13. Definition of done

- `/assets/*` carries `immutable` in production and under `wrangler dev`;
  `/` does not.
- 11 tools register, in order, all-or-nothing, on a fake host that
  resolves each registration late; total registration time is one delay.
- The host poll is 500 ms while visible and 3 s while hidden, for the
  life of the tab; `get_perf_report` on a real ChatGPT session shows the
  discovery gap under 600 ms.
- *"Hexagonal planter, 18 cm tall, 13% shrinkage, in inches"* is one call
  and one undo step; *"make it hold 350 ml"* is one call; both return the
  full state; the legacy `type` values are advertised and accepted.
- `describe_project` no longer says "call this first"; the suite asserts it.
- A fresh ChatGPT conversation's first reply carries the "Open a paired
  browser session with this chat" link and the code alternative; the
  snapshot's `session.paired` is what the agent decided on.
- Discovery metadata is under the lowered budget; `describe_project`'s
  envelope is under 1,200 B; both numbers are in the commit messages and
  in docs/performance-report.md.
- `TOOL_RESULT_CONTRACT` is `tool-result/2` and the manifest, tests and
  report agree.
- §9's review notes are linked from docs/live-handoff-link-spec.md.

## 14. Traceability — review finding → section

| finding | section |
| --- | --- |
| fingerprinted assets revalidated on every load in production | §8 |
| three sequential calls for one potter sentence; ~280 ms host cost per call | §4 |
| second round trip per edit turn (link rule) | §9 (kept; review after launch) |
| snapshot carried twice, pretty-printed, with two constants | §5 |
| "Call this first" induces a read before absolute edits | §6.1 |
| a fresh ChatGPT session is offered only the pairing code, never the paired-browser link | §6.2 |
| 3 s host poll after 15 s; no poll while hidden; sequential registration | §7 |
| metadata size (trimmed to 9,029 chars, budgeted), boot, 3D/PDF chunks, preview payload | healthy — §2 non-goals |

## 15. References

- docs/performance-report.md — the audit this spec re-measures: the
  metadata trims (§1), the native-host cost (§1.2), the structured-result
  decision (§7)
- docs/live-handoff-link-spec.md — the link contract §9 preserves
- docs/webmcp-profiler-0.2-spec.md — `get_perf_report` and the ledger §7 measures with
- AGENTS.md — the gate every commit passes
- Cloudflare Workers static assets, headers: <https://developers.cloudflare.com/workers/static-assets/headers/>
- WebMCP Draft Community Group Report: <https://webmachinelearning.github.io/webmcp/>
