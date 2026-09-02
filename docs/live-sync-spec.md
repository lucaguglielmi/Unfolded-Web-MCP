# Live Sync Spec v3 — WebSocket sessions, codes, and single-use link tokens

Status: **implemented** — the v2 work items below (all ten, in order, each
with green gates — see the branch history). Supersedes the v1 spec (link/QR
`sid` pairing). Direction: **pairing happens by relaying a short-lived
6-character code between devices — spoken or typed through the agent chat —
and the session id never appears in any URL.** Two deviations from the letter
of the spec, both recorded in §10: `hello` carries the tab's design slice for
first-contact bootstrap (eager creation would otherwise welcome the minting
tab with a default mug), and patch broadcasts include the sender so its own
echo teaches it the version its edit landed at. Server tests run as pure-core
vitest suites plus a live `wrangler dev` smoke suite with real sockets
(`npm run e2e:worker`, `npm run e2e:pairing`) — vitest-pool-workers does not
support this repo's vitest major.

Decisions taken 2026-08-31 (previously open):
- **Code TTL: 15 minutes.** Confirmed.
- **Eager session creation.** Minting a code on a never-synced tab creates
  the session immediately, so the code keeps working even if the minting tab
  closes before it is claimed.
- **Agent-minted codes (`start_pairing`) are v1, not stretch** — forced by
  user flow B (§5.2): without the reverse direction, moving phone-born work
  to a desktop adopts state the wrong way.
- **Idle-session retention: 30 days.** Confirmed.
- **In-piece QR stays 22 mm.** If the largest piece can't host it, the QR
  moves just *outside* that piece on the same template page (§6) — never
  shrunk, never overview-only.

## 1. Problem

WebMCP is tab-scoped: the agent in a phone tab (ChatGPT's internal browser,
or Chrome with `#enable-webmcp-testing`) mutates that tab's zustand store
only. All persistence is device-local. Goal: pair a phone and a desktop so
that when any actor (human or agent, either device) edits the design, every
paired tab reflects it within ~1 s, bidirectionally — with a pairing gesture
that works *inside a chat conversation*, where links are broken (tapping a
link in ChatGPT opens the ordinary in-app browser, a separate session without
WebMCP).

## 2. Non-goals (v1)

- **Accounts or identity.** Pairing proves "this person can read that
  screen." WebMCP passes no caller identity to the page (by design of the
  proposal); "Sign in with ChatGPT" is a partner-beta OAuth product that
  would force accounts into a no-login app. Possession of the code is the
  authentication.
- **Session ids in URLs.** Share links, the address bar, the printed QR, and
  agent-returned `shareUrl`s stay exactly as inert as today; a chat
  transcript holds at most a dead 6-character code.
- **Shared cross-device undo history** (per-tab undo converges, §7.4).
- **CRDTs / merging beyond per-field last-write-wins** (a dozen scalars).
- Syncing anything beyond the design slice `{form, clay, paperSize, unit}`.

## 3. Architecture overview

```
phone tab ──ws──▶ ┌─────────────────────────┐ ◀──ws── desktop tab
 (agent edits)    │ SessionDO (one per sid) │
                  │ canonical state+version  │
                  └───────────▲─────────────┘
                              │ register/claim codes
                  ┌───────────┴─────────────┐
                  │ PairingDO (singleton)    │
                  │ code → sid, TTL, burns   │
                  └─────────────────────────┘
```

- **`SessionDO`** — one Durable Object per session (`sid`: 128-bit
  crypto-random, known only to the server and paired clients' localStorage),
  canonical design state + monotonic `version`, WebSocket Hibernation API so
  idle sessions cost nothing.
- **`PairingDO`** — one well-known singleton (`idFromName("global")`)
  holding *active pairing codes only*: `code → {sid, expiresAt}`. Codes are
  global (a claimer knows only the code), so resolution needs one authority;
  KV is ruled out (eventual consistency breaks one-time use).
- Tabs exchange **patches** whose wire shape is `SharePatches` — exactly what
  `parseShareParams` produces and `openModel` consumes. No new model
  vocabulary.
- **Progressive enhancement:** without `/api/*` (plain `vite dev`, a static
  mirror) the sync module stays off and the app is exactly today's app.

## 4. Pairing by code

### 4.1 Code format

- **6 characters** from the 31-glyph alphabet
  `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no `I L O 0 1` — nothing ambiguous to
  read aloud or retype). 31⁶ ≈ 8.9×10⁸.
- Displayed grouped for reading: `K7F-3QP`. Input normalized: uppercase,
  separators/whitespace stripped.
- **TTL 15 minutes** (decided), **single use** (burned on successful claim),
  minted fresh on every request. A code is *only* a pairing ticket — it
  never identifies the session afterwards.

### 4.2 The two directions

Both exist in v1; they share the one rule in §4.3.

- **Screen mints, chat joins** (flow A): desktop header → **"Pair a
  device"** → the tab requests a code from its `SessionDO` (created eagerly
  if the tab has none — decided) and shows `K7F-3QP` with a 15-minute
  countdown and the copy *"tell your assistant: join my session, code
  K7F-3QP — anyone who enters this code within 15 minutes can edit this
  design live."* The potter tells the agent on the phone, the agent calls
  **`join_session`** (§8), the phone joins.
- **Chat mints, screen joins** (flow B): the potter tells the agent *"give
  me a code for my desktop"*; the agent calls **`start_pairing`** (§8),
  which mints eagerly from the phone tab's session and shows the code in the
  chat reply (and on the phone tab). On the desktop, the same "Pair a
  device" dialog has an **"enter a code"** field; typing the code makes the
  desktop join the *phone's* session.
- The dialog's manual entry also makes both directions work human-to-human
  with no agent at all.

### 4.3 Join semantics (one rule)

**The claimer adopts the minted session's state.** Claiming a code means
"follow that session": the joining tab's design is replaced by the session's
current state, applied through `openModel` so it is one undo step. This is
why flow B needs `start_pairing`: when the work lives on the phone, the
*desktop* must be the claimer. After joining, no device is special; the
mint/claim asymmetry exists only at pairing time.

### 4.4 Session persistence & unpairing

- Each paired tab stores `{sid}` in `localStorage` under
  `unfolded:session:v1` (a **new** key — the frozen existing keys are
  untouched). Refresh and revisits rejoin silently; the pairing outlives the
  code by design.
- **"Unpair this device"** in the dialog: disconnect + delete the local key.
  Server side, a session with zero connections for **30 days** (decided)
  deletes its storage via alarm.
- "Pair a device" on a tab already in a session issues a code for *that*
  session — n-device pairing falls out for free, capped at 16 sockets.

### 4.5 Abuse resistance (why 6 characters is enough)

30 bits is protected by process, not entropy: 15-minute TTL, single use,
claim rate limits (per-IP: 10 claims/min at the worker; global: PairingDO
rejects when >100 claims/s). A wrong code is a uniform miss: unknown,
expired, already-used, and malformed all answer the same 404, so there is no
oracle for "exists but expired". Resolution is a hash-map lookup on the
normalized code, not a byte-wise string compare, so there is no comparison
to make timing-safe; what bounds probing is the throttle, not comparison
timing. With ≤ ~100 codes live at any moment, one guess hits with p ≈ 10⁻⁷;
a maxed-out attacker inside the limits expects centuries per hit, and a hit
yields edit access to one stranger's mug dimensions for one session. The
per-IP limit is configurable (`PAIR_CLAIMS_PER_IP_PER_MINUTE`, read by
PairingDO) for local test runs only, where every browser context shares one
address; production sets no vars and keeps the default.

## 5. User flows

The three ways a potter actually arrives, and what each one exercises.

### 5.1 Flow A — starts on the desktop, continues with the agent

The studio baseline: design at the bench on the big screen, then pick up the
phone to talk it through. Desktop mints (`Pair a device`), potter dictates
the code to the agent, agent `join_session`s, phone adopts the desktop's
design. Every agent edit (*"make it hold 350 ml"*) lands on the desktop
preview in ~1 s; every desktop slider move is visible to the agent's next
`describe_project`. Exercises: UI mint, tool claim, adopt-on-join,
bidirectional patches.

### 5.2 Flow B — starts with the agent

The headline WebMCP scenario: the whole design is born in conversation on
the phone (ChatGPT's internal browser or Chrome-with-flag) — *"a hexagonal
planter, 18 cm tall"* — and only later does the potter want it big on the
desktop. Direction matters here: if the desktop minted and the phone joined,
§4.3 would make the phone adopt the desktop's (default) design and bury the
conversation's work under an undo step. So the potter asks the agent for a
code (`start_pairing`), types it into the desktop's "enter a code" field,
and the *desktop* adopts the phone's design. This flow is why
`start_pairing` is v1 (decided). Exercises: tool mint, eager session
creation on the phone tab, UI claim.

### 5.3 Flow C — starts from the QR on an old printed template

Weeks or months later, the paper template comes out of the studio drawer for
a re-run — new clay body, or a customer wants the mug 10% bigger. The potter
scans the QR printed with the template; the phone's browser opens the app
with that exact design's parameters (the QR encodes a plain share link —
parameter-only, origin-absolute at print time, never a session capability).
From there every path is open: tweak by hand, engage the agent in that tab
(*"my new clay shrinks 14%, fix my templates"*), or bridge to the desktop
via flow A or B and export a fresh PDF. Exercises: share-link boot →
pairing from a link-opened tab; also §6's QR placement change, which makes
this flow survive the overview page being thrown away.

## 6. PDF change: the QR moves into a template piece

Today the QR ("scan to reopen this design") sits on the overview page
(`pdf.ts` page 1, top-right). But the overview is scaffolding — after
cutting, what survives in the studio is the template pieces themselves, laid
on clay, splashed and filed. Flow C depends on the paper that *survives*.

**Change:** print the QR **inside the largest template piece's interior**
(the wall rectangle/panel in practice), so every cut-out template physically
carries the link to the software that reopens it with the right parameters.

- Placement: centroid-ish, ≥ 8 mm clear of every cut/fold/miter line and of
  the piece's dimension labels; standard quiet zone; **22 mm** (decided —
  matches the overview QR, scans reliably on handled paper) with the
  unfolded mark inset, plus the "scan to reopen this design" caption.
- Fallback (decided): if the largest piece can't host 22 mm + quiet zone
  (tiny forms), the QR prints **just outside that piece on the same
  template page** — nearest free spot to the piece within the printable
  area, clear of every other piece and of the page's calibration bar, with
  a thin dotted keep-tab outline and the same caption, so the potter can
  cut it out alongside and file it with the templates. Never shrunk below
  22 mm. The overview QR stays in all cases (it's the one visible without
  digging through cut pieces).
- The QR remains a **parameter-only share link** — never a `sid`, never a
  code. A found template grants a copy of the design, not entry to a live
  session (§2).
- Independent of the sync backend: pure `pdf.ts`/`svg.ts` layout work,
  gated only by the feature freeze — it can ship before any Durable Object
  exists and makes flow C real on its own.

## 7. Sync semantics (carried from v1 of this spec, unchanged in substance)

### 7.1 Server state & the normalization problem

`updateForm` is not a plain merge: it flares the top when taper turns on and
mirrors top←bottom for straight forms (`useProjectStore.ts`). A naively
merging DO would diverge from every client, and each `welcome`/`resync`
would "correct" them wrongly. **Resolution:** extract the pure patch
application (normalize → merge → taper/mirror) into
`src/lib/model/applyPatch.ts`, used by **both** the store's `updateForm` and
the DO. Prerequisite work item 1, valuable standalone. The DO validates
every patch with the same zod schemas; invalid → `error`, state untouched
(mirroring the tools' `isError` posture).

### 7.2 Publisher (local edits → out)

The `persistence.ts` pattern: subscribe to the design slice, debounce
~250 ms, diff against `lastSyncedState`, send only changed fields as
`SharePatches`, advance `lastSyncedState` on send. Diffing *state* covers
every mutation path — sliders, agent tools, presets, `open_model`,
undo/redo — with no action instrumentation.

### 7.3 Receiver & echo suppression

On a peer's `patch`: apply via `openModel(patches)` (validated, one undo
step), then set `lastSyncedState` to the result in the same synchronous
frame so the publisher's next diff is empty. Self-echoes drop by `clientId`.
Field-level LWW: different-field concurrency both win; same-field races
resolve to the later arrival, and the loser sees the winning value within a
second.

### 7.4 Undo across devices

Remote patches enter local undo history as ordinary steps, preserving
"human and agent are peers": undo on the desktop reverts the phone agent's
last edit locally, and the publisher broadcasts the reversion as a normal
patch, so all devices converge. Accepted quirk: two devices undoing "the
same" step double-revert; convergence still holds.

### 7.5 Reconnection & offline

Exponential backoff (1 s → 30 s, jittered); reconnect also on
`visibilitychange`→visible, `online`, `focus` — phones freeze background
tabs wholesale, so every return to the tab is a convergence check
(`wake()`). A frozen socket rarely announces itself: it may be torn down
with no close event, or left open on paper with every broadcast since the
freeze lost. So a wake with no socket reconnects at once (backoff reset);
a socket that never opened is dropped and replaced; an open socket is
probed with a `hello` — the server re-welcomes with a full snapshot, which
is the catch-up — and 4 s of silence declares it dead and reconnects. On
`welcome` after a gap: apply server state, then send surviving local edits
as one diff (per-field local-wins for offline edits, documented LWW).
Sends the server never echoed (the `patch` echo carries the sender's
`patchId`) count as local edits too: a frozen socket swallows them
silently, so the next welcome re-applies and resends them. The solo grace
is suspension-aware: a timer firing far past its due time ran while the
tab was frozen, so it grants a short probation for the wake resync to
report peers instead of forgetting the session on a stale verdict. A
claimed-then-unreachable session (claim OK, WS fails) rolls back to
unpaired with a toast.

### 7.6 Presence UI

The three-state agent pill's semantics are **frozen** — sync must not
become a fourth `agentStatus`. A separate small indicator: nothing when
unpaired; "syncing" (grey) while connecting; "n devices" (green) when ≥2.
States only what the socket confirms.

## 8. WebMCP tool surface change (two new tools)

Both registered in `src/mcp/tools.ts` with entries in `TOOL_SUMMARIES` (the
`/webmcp` page renders and counts from it; the unit test fails the build if
a summary is missing), the README table, and the e2e `EXPECTED_TOOLS`
(updated deliberately — it is the independent contract check). Lands only
after the freeze lifts.

- **`join_session`** — *"Pair this tab into a live session using the
  6-character code shown on the potter's other device."*
  - input: `{code: string}` (zod: trimmed, separators stripped, uppercased,
    `/^[A-HJ-NP-Z2-9]{6}$/`)
  - annotations: `{title: "Join live session"}`
  - behavior: claim → connect → adopt session state (§4.3); success returns
    the full new state prefixed
    `"Joined live session — now syncing with N other device(s)."`; failure
    returns `isError` with unchanged state and the uniform
    `"That code didn't work — codes expire after 15 minutes and can be used
    once. Ask for a fresh one."` Client-side backoff after 3 failures; the
    server rate limit is the real guarantee.
- **`start_pairing`** — *"Mint a 6-character code so the potter's other
  device can join THIS design's live session."*
  - input: `{}` — annotations: `{title: "Start device pairing"}`
  - behavior: eager-create session if the tab has none (decided), mint via
    PairingDO, return
    `"Pairing code: K7F-3QP — valid 15 minutes, one use. On the other
    device: menu → Pair a device → enter this code. That device will adopt
    this design."` plus the full state. The phone tab shows the same code +
    countdown so the potter can read it off either surface.

Everything else stays: the agent needs no tool to *sync* (transparent under
the store).

## 9. Page & doc copy changes

The new way of working must be visible where visitors learn the app. All
copy lands with the feature (work item 8), not before.

- **`/webmcp` (`WebMCPPage.tsx`)** — the in-app WebMCP guide:
  - New section **"Work across devices"** after the connection-states
    section: the code-pairing model in potter's terms (mint on one screen,
    speak it to the chat, both stay live), the §4.3 adopt rule ("the device
    that enters the code follows the other one"), and the honesty note in
    the house style: *a code is a 15-minute, one-use key; the app never puts
    a live session in a link.*
  - The tool table extends automatically via `TOOL_SUMMARIES`.
  - "Things to try" gains: *"join my desktop session, code K7F-3QP"* and
    *"give me a pairing code for my desktop."*
  - The live connection-status block additionally shows this tab's pairing
    state (unpaired / syncing / n devices), mirroring §7.6.
- **`/why` (`WhyPage.tsx`)** — the README-as-page: inherits the README
  rewrite below wherever it mirrors those sections; its narrative gains one
  paragraph in the workflow story: design doesn't live in one chair — start
  at the bench, continue in chat, come back from a printed template
  (flows A–C, §5).
- **`README.md`**:
  - New **"Sync live between devices"** section: the three flows, the code
    ceremony, the privacy line — *the design slice is the only thing that
    ever leaves the device, sessions are unlisted and expire after 30 idle
    days, and no URL ever carries a durable capability.* (v3 wording —
    see the amendment at the end of this document.)
  - Tool table + "non-trivial WebMCP parts" updated for the two new tools;
    the share-links section states explicitly that links (and the printed
    QR) stay parameter-only.
  - PDF/"Why this exists" copy notes the QR now travels inside the largest
    template piece (§6).
- **Pair dialog** copy as specced in §4.2/§8.

## 10. Wire protocol

JSON text frames, `protocolVersion: 1` in `hello`. Unknown kinds/fields
ignored (same forgiving posture as share-link parsing).

Client → server (SessionDO socket): `hello {protocolVersion, clientId,
actor, state?}` — `state` is the tab's design slice, used only for
first-contact bootstrap so an eagerly created session adopts the minting
tab's design instead of a default mug (ignored once the session is
initialized) · `patch {patchId, baseVersion, patches: SharePatches}` ·
`mint_code {}` (reply `code`) · `bye {}`.

Server → client: `welcome {state, version, peers}` · `patch {version,
patches, clientId, actor}` — broadcast to ALL including the sender, whose
own echo is how it learns the version its edit landed at · `resync {state,
version}` · `presence {peers}` · `code {code, expiresAt}` ·
`error {code, message}`.

HTTP (worker): `POST /api/pair/claim {code}` → `{sid}` or uniform failure —
the **only** place a `sid` crosses to a client, used solely to open
`GET /api/session/:sid/ws` and to persist `unfolded:session:v1`.

Versioning is for gap detection only (`version > lastSeen + 1` → request
`resync`); patches are never rejected as stale — merging is per-field LWW.

## 11. Server implementation

- `wrangler.jsonc`: `durable_objects` bindings `SESSION` → `SessionDO`,
  `PAIRING` → `PairingDO`; `migrations` with `new_sqlite_classes`
  (free-tier compatible); `/api/*` handled before assets (already
  `run_worker_first: true`).
- Worker (`worker.js` → `worker/index.ts`, TS so it can import the shared
  schemas and `applyPatch`): routes `POST /api/pair/claim` (per-IP limit
  here) and `GET /api/session/:sid/ws` (validate `sid` shape →
  `idFromName(sid)` → forward upgrade); everything else falls through to
  the www-redirect + assets behavior exactly as today.
- `SessionDO`: hibernation-aware; storage `state`, `version`, `updatedAt`;
  alarm deletes storage after 30 idle days; `mint_code` registers with
  `PairingDO`.
- `PairingDO`: in-storage code table, TTL sweep by alarm, global claim
  throttle, uniform misses (resolution is a map lookup — nothing to compare
  timing-safely).
- Limits: frame ≤ 8 KB, ≤ 16 sockets/session, ≤ 20 msg/s/socket → `error` +
  close. All input zod-validated; unknown ignored.

## 12. Privacy & security review

- **What leaves the device (new):** the design slice, coarse presence
  (actor kind, tab count), and — during pairing only — a 6-character code.
  No names, no chat content, no user agent stored. README updated (item 8).
- **No URL ever carries a durable capability** (v3 amendment; v2 said "no
  URL is ever a live capability", which the single-use link tokens below
  superseded) — share links, address bar, printed
  QR (§6 keeps it parameter-only *by specification*), agent `shareUrl`s.
- **Residual threats:** shoulder-surfing an unclaimed code (5-min window,
  countdown visible, potter sees the device count change); a lost paired
  device (no peer eviction in v1 — abandon the session; eviction is
  stretch); brute force (§4.5); malicious peer garbage (schemas + clamps);
  valid-but-unwanted edits (inherent to pairing — undo works, sessions
  abandonable, idle-expire).
- **`start_pairing` in a transcript** shows a code that is dead within 15
  minutes; showing it in chat is the feature and the risk window is the
  TTL.

## 13. Testing

- **Unit (pure):** `applyPatch.ts` parity with today's store behavior
  (table-driven); diff/merge + echo bookkeeping; code normalize/format; QR
  placement geometry against `buildPieces` fixtures — largest-piece
  selection, quiet-zone clearance, and the too-small fallback (outside
  placement collides with no piece, no calibration bar, and stays on the
  printable area at 22 mm).
- **DO tests (`@cloudflare/vitest-pool-workers`):** mint→claim→burn (second
  claim uniform-fails), TTL expiry, eager create (mint from a fresh tab,
  claim after minter disconnects — decided behavior), rate limits, two-
  socket fan-out, gap → resync, alarm deletion.
- **e2e (extend `e2e/run.mjs`):** flow A (UI mint, `join_session` claim,
  bidirectional edits converge); flow B (`start_pairing` on context "phone",
  manual claim on "desktop", desktop adopts phone's design); flow C (boot
  from a share-link URL, then pair); offline/reconnect; expired-code
  `isError`.
- **Contract guards:** `TOOL_SUMMARIES` ↔ `buildTools` test already forces
  summaries for both tools; a no-`/api` boot test asserts today's behavior.

## 14. Work items (ordered; each ships alone, green gates as in refactor-spec)

1. **`applyPatch.ts` extraction** — store behavior byte-identical.
   *Prerequisite; valuable standalone.*
2. **QR into the largest template piece (§6)** — pure PDF/SVG layout +
   fallback + tests. *Independent of the backend; enables flow C alone.*
3. **`syncClient.ts` core (no UI, no pairing)** — connect/welcome, publisher
   diff, receiver apply, echo suppression; active only when
   `unfolded:session:v1` exists.
4. **`SessionDO` + worker routing + wrangler config.**
5. **`PairingDO` + mint/claim + eager create + limits.**
6. **Pairing UI** — dialog (code display + countdown + enter-a-code +
   unpair), localStorage rejoin. Accept: flows A and B human-to-human, no
   agent.
7. **`join_session` + `start_pairing` tools** + `TOOL_SUMMARIES`/README/e2e
   `EXPECTED_TOOLS`. Accept: flows A and B via `__unfoldedTools`; e2e.
8. **Copy pass (§9)** — `/webmcp` section + pairing status, `/why`
   narrative, README rewrite.
9. **Reconnect/resync/offline queue.** Accept: e2e offline scenario.
10. **Presence indicator.**

Estimate: ~800 LOC production + ~500 LOC tests. Items 1–3 carry half the
risk and are reviewable with no infrastructure; item 2 ships value alone.

## 15. Stretch (explicitly not in v1)

- Evicting a peer / rotating the `sid` from any device.
- Read-only join codes.
- Peer labels ("phone · agent active") in presence.
- Server-ordered shared undo history.

## 16. Design review

Reviewed against the codebase on 2026-08-31 (updated same day for flows +
decisions):

- **Flow B forced a real change:** claimer-adopts (§4.3) is the right single
  rule, but it makes direction load-bearing — the device holding the work
  must mint. Promoting `start_pairing` to v1 costs one more tool on the
  frozen surface and ~40 LOC; the alternative (heuristics about which design
  "looks worked-on") was rejected as magic. Right call.
- **Two tools, one rule** is the complexity ceiling: both tools share the
  claim path and the §4.3 rule, so the mental model stays "mint where the
  work is, type the code where it should follow."
- **QR-in-piece (§6) is the sleeper item:** it's the only work item that
  needs no backend and it completes the product loop — screen → paper →
  clay → (months later) paper → screen — with the same parameter-only-link
  guarantee as today. Risks are layout ones (QR colliding with fold marks
  or labels on small pieces; ink where a potter cuts) — handled by the
  clearance rule and the decided fallback (never shrink: move outside the
  piece onto the same page with a keep-tab outline), verified by geometry
  tests, and worth one manual print-and-scan check on A4 and Letter.
- **Eager creation (decided)** trades a handful of possibly-never-claimed
  DO creations for a code that never lies about being valid. Cheap
  (SQLite-backed DOs, ≤1 KB state, 30-day sweep) and honest. Fine.
- **Biggest technical risk stays normalization drift (§7.1)** — item 1
  first, alone, with parity tests.
- **PairingDO singleton** is a theoretical bottleneck, irrelevant at
  human-paced claim rates, and what makes one-time use atomic. Accepted.
- **LWW same-field races** and **`unit` syncing** — accepted as before
  (independent scalars; paired devices disagreeing on display units is
  worse than syncing a preference).
- **Copy is specced as a work item (§9), not an afterthought** — the app's
  differentiator is that its pages tell the truth about connection state;
  pairing gets the same treatment (the indicator only states what the
  socket confirms, the dialog names the 15-minute/one-use terms).
- **Verdict:** sound to build; sequencing unchanged — nothing before the
  Sep 3 freeze lifts; then items 1–3 (pure TS, no infrastructure), with
  item 2 shippable value on its own.

## Open questions

None — all resolved. Decisions are recorded at the top of this document;
implementation can start the moment the Sep 3 feature freeze lifts, in work-
item order (§14).


---

# v3 plan — "Continue on another screen"

Status: **implemented** (owner said go, all three recommendations taken:
tokens on all agent shareUrls, QR-first dialog with the code collapsed,
15-minute token TTL). One addition the e2e forced: the Continue dialog
never reuses an invite across opens — the tab may have joined a different
session in between, and a cached link would point at the one it left. Reframes pairing around the realization
that codes are the fallback, not the flow, and solves the ChatGPT
two-browser problem (the agent's WebMCP runs in a hidden internal browser;
the tab the person actually looks at is a separate, dead snapshot).

## 1. The reframe

The surface stops being "Pair a device" (infrastructure language) and
becomes **"Continue on another screen"** — device-aware: the phone offers
*"Continue on desktop"*, the desktop *"Continue on your phone"*. The copy
leads with the outcome (your design, live, over there) and makes explicit
that the OTHER screen needs no WebMCP: sync is a plain WebSocket, so any
browser can follow — WebMCP is only how agents edit, not how devices stay
current.

## 2. One-time join tokens — the mechanism under every new flow

A **join token** is a claim ticket that can ride a URL: ≥96-bit URL-safe
random (guessing is void, unlike spoken codes), minted by the tab's
SessionDO into the same PairingDO registry as codes, TTL ~15 minutes,
**single use, burned on claim**, and never the `sid`. A tab opening a link
with `&join=<token>` silently claims it, joins the session (adopt-on-join
unchanged, everPeered=true — a token, like a code, is proof), and strips
the parameter from the address bar via replaceState.

This is a measured amendment to the privacy rule, recorded as such: from
"no URL is ever a live capability" to **"no URL ever carries a durable
capability — at most a single-use, short-lived claim ticket, dead after
its first open."** A leaked or transcript-logged link holds a burned
token. The printed PDF QR stays parameter-only, unchanged.

## 3. The three flows, ranked

1. **Scan to continue (primary, human-to-human).** The Continue dialog
   shows a QR that encodes the design's share link PLUS a fresh join
   token. Scanning it = the other device opens live-following. No typing,
   no code. The QR regenerates when its token expires.
2. **Tap to continue (primary, ChatGPT — solves the hidden browser).**
   When an agent is driving a tab (agentStatus native), that tab keeps its
   session alive and every `shareUrl` in tool results carries a fresh join
   token. The agent already hands links into the chat; the person taps
   one, ChatGPT's visible in-app browser opens it, claims the token — and
   the tab the person is looking at becomes a live follower of the hidden
   browser the agent edits in. Edits flow BOTH ways: a slider drag in the
   visible tab shows up in the agent's next read. Every fresh link the
   agent hands over carries a fresh token, so it keeps working even if the
   in-app browser wipes storage between opens.
3. **Read a code (fallback).** The 6-character code stays for the spoken
   path — telling an agent "join my desktop session, code …" — collapsed
   behind "or use a code instead" in the dialog. join_session and
   start_pairing keep their names and behavior.

## 4. Mechanics

- **Token minting**: `mint_token` message on the session socket (same shape
  as `mint_code`); PairingDO stores codes and tokens in one table with a
  type tag; `POST /api/pair/claim` accepts either (shape-discriminated),
  same rate limits and uniform misses.
- **Agent-tab auto-session**: when agentStatus flips to native, the tab
  pairs itself lazily (first shareUrl build) and prefetches one token at a
  time — shareUrl stays synchronous by attaching the prefetched token and
  requesting the next. If no person ever taps a link, the existing
  16-minute solo grace forgets the session; a claim makes it real
  (everPeered).
- **Claim on open**: applyShareLinkFromLocation detects `join`, claims it
  after applying the design params, joins on success, strips the param
  either way. Failure (burned/expired) degrades to today's behavior — the
  design still opens from the parameters.
- **Share vs Continue**: the Share dialog's QR/link stays inert
  (sharing a design must never grant session access); only the Continue
  dialog and agent shareUrls carry tokens.

## 5. Testing

Unit: token mint/claim/burn alongside codes; URL claim-and-strip; the
prefetch pool. Pairing e2e additions: fake-agent context A generates a
tokened shareUrl, context B opens it and follows live; opening the SAME
link again in context C does not join (burned) but still shows the right
design; the Continue dialog QR pairs a second context.

## 6. Decision points (owner's call, recommendations attached)

1. Do ALL agent shareUrls carry tokens once an agent is native, or only
   after the agent/user asks to continue elsewhere? **Recommend: all** —
   it is what makes the ChatGPT flow zero-effort, and burned tokens make
   the transcript exposure a non-issue.
2. Does the QR become the Continue dialog's primary surface with the code
   collapsed? **Recommend: yes.**
3. Token TTL: **recommend 15 minutes** (links sit in chat a little longer
   than spoken codes).


---

# Handoff amendment (2026-09-02) — two links, one tool

Implemented per `docs/live-handoff-link-spec.md`, which is normative for
link selection; this section only reconciles the wording above.

- **Agent-facing URLs are two, by name.** `designUrl` (in every state
  snapshot) is the permanent permalink: parameters only, no token, no
  session — the address bar, the Share dialog, the printed QR. It reopens
  an independent copy. `liveHandoffUrl` is the same parameters plus
  `?via=chatgpt` and a **single-use, 15-minute join token**; it exists
  only as the output of the `create_live_handoff` tool, minted on demand
  (`mint_token` on the session socket) and fail-closed: no token, no link.
- **State reads are pure.** `describe_project` and every mutation return
  `designUrl` and never mint, prefetch, or spend a token. The v3 "prefetch
  one token per agent tab and attach it to every shareUrl" mechanism is
  retired: it produced links that pair without anyone asking, and — the
  incident that motivated the change — let an agent substitute the
  address-bar URL for the tokened one, handing out a link that opened the
  right shape and silently did not pair.
- **Claim behaviour is unchanged.** An opening tab applies the design
  parameters, reads `join`, strips it from the address bar, claims it, and
  follows on success; a burned or expired token degrades to the design
  snapshot. `via=chatgpt` is provenance only ("Opened from ChatGPT"); the
  sync dot states pairing from the socket alone.
- **Wording.** "No URL is ever a live capability" → "no URL ever carries a
  *durable* capability": a live handoff URL carries a single-use,
  short-lived claim ticket; no URL ever carries a session id.
- **Tool count** is fourteen; `/webmcp` derives it from `TOOL_SUMMARIES`
  and `src/mcp/docsGuard.test.ts` pins the README table to the same list.

- **Lifetimes (2026-09-02).** Codes and tokens both live **15 minutes**
  (codes were 5, tokens 10; the hub's Open-in-ChatGPT flow — app switch,
  login, the agent's hidden browser, a slow first turn — could outrun 5).
  The §4.5 arithmetic scales linearly: three times the live codes, three
  times the exposure of a code that sits in a transcript, still centuries
  per hit inside the rate limits. The minting tab's solo grace moved to
  16 minutes with it. All numbers in this document were updated in place.
  Considered and **declined** (owner's decision, 2026-09-02): carrying a
  128-bit join token instead of a spoken code in the Open-in-ChatGPT
  prompt, which would have let the spoken code stay short. One
  invitation shape per surface stays: codes for the prompt and voice,
  tokens for links.
