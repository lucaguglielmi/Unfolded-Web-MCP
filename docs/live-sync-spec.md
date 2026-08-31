# Live Sync Spec v2 — WebSocket session layer with 6-character code pairing

Status: **draft — not started**. Supersedes and replaces the v1 spec (which
paired devices via a `sid` query parameter on share links). Direction change:
**pairing happens by relaying a short-lived 6-character code between devices —
spoken or typed through the agent chat — and the session id never appears in
any URL.** Nothing here is implemented.

**Deadline context:** `docs/refactor-spec.md` freezes features until the WebMCP
Challenge submission (Sep 3). This entire spec is **post-deadline work**. The
freeze also covers the WebMCP tool surface; the new tool in §7 lands only
after it lifts.

## 1. Problem

WebMCP is tab-scoped: the agent in a phone tab (ChatGPT's internal browser, or
Chrome with `#enable-webmcp-testing`) mutates that tab's zustand store only.
All persistence is device-local. Goal: pair a phone and a desktop so that when
any actor (human or agent, either device) edits the design, every paired tab
reflects it within ~1 s, bidirectionally — with a pairing gesture that works
*inside a chat conversation*, where links are broken (tapping a link in
ChatGPT opens the ordinary in-app browser, a separate session without WebMCP).

## 2. Non-goals (v1)

- **Accounts or identity.** Pairing proves "this person can read that screen,"
  nothing more. WebMCP passes no caller identity to the page (by design of the
  proposal), and "Sign in with ChatGPT" is a partner-beta OAuth product that
  would force accounts into a no-login app. Possession of the code is the
  authentication.
- **Session ids in URLs.** v1 of this spec put `sid` on share links; that made
  every synced share link — and any chat transcript holding one — a live edit
  capability. Dropped entirely: share links stay exactly as inert as today,
  the printed PDF QR needs no special-casing, and transcripts hold at most a
  dead 6-character code.
- **Shared cross-device undo history** (per-tab undo converges, §6.4).
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
  crypto-random, server-known only), canonical design state + monotonic
  `version`, WebSocket Hibernation API so idle sessions cost nothing.
- **`PairingDO`** — one well-known singleton (`idFromName("global")`) holding
  *active pairing codes only*: `code → {sid, expiresAt, attempts}`. Codes are
  global (a claimer knows only the code), so resolution needs one authority;
  KV is ruled out (eventual consistency breaks one-time-use).
- Tabs exchange **patches** whose wire shape is `SharePatches` — the exact
  shape `parseShareParams` produces and `openModel` consumes. No new model
  vocabulary; the share-link contract stays the single model contract.
- **Progressive enhancement:** without `/api/*` (plain `vite dev`, a static
  mirror) the sync module stays off and the app is exactly today's app.

## 4. Pairing by code (the core of v2)

### 4.1 Code format

- **6 characters** from the 31-glyph alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789`
  (no `I L O 0 1` — nothing ambiguous to read aloud or retype). 31⁶ ≈ 8.9×10⁸.
- Displayed grouped for reading: `K7F-3QP`. Input is normalized: uppercase,
  separators/whitespace stripped.
- **TTL 5 minutes, single use** (burned on successful claim), minted fresh on
  every "Pair" click. A code is *only* a pairing ticket — it never identifies
  the session afterwards.

### 4.2 Primary flow (desktop shows, agent joins)

1. Desktop header → **"Pair a device"** → the tab (already connected to its
   `SessionDO`, connecting on demand if not) requests a code; the dialog shows
   `K7F-3QP` with a 5-minute countdown and the copy *"tell your assistant:
   join my session, code K7F-3QP — anyone who enters this code within 5
   minutes can edit this design live."*
2. On the phone — ChatGPT's internal browser or Chrome-with-flag, app open —
   the user tells the agent: *"join my desktop session, code K7F3QP."*
3. The agent calls the **`join_session`** tool (§7). The app claims the code,
   receives the `sid`, connects its WebSocket, and adopts the session's
   current state (one undoable step). Both tabs show "2 devices".
4. From then on sync is fully bidirectional (§6); the code is dead.

The same dialog also offers manual entry ("have a code? enter it") so pairing
works human-to-human with no agent involved, in either direction.

### 4.3 Join semantics

**The claimer adopts the minted session's state.** Claiming a code means
"follow that session": the joining tab's current design is replaced by the
session's state, applied through `openModel` so it is one undo step (nothing
is lost — undo restores the local design *and*, being a normal edit, syncs
it back if that's what the potter wanted). After joining, no device is
special: the mint/claim asymmetry exists only at pairing time.

### 4.4 Session persistence & unpairing

- Each paired tab stores `{sid}` in `localStorage` under
  `unfolded:session:v1` (a **new** key — the frozen existing keys are
  untouched). Refresh and revisits rejoin silently; the pairing outlives the
  code by design.
- **"Unpair this device"** in the dialog: disconnect + delete the local key.
  Server side, a session with zero connections for **30 days** deletes its
  storage via alarm.
- Mint-time note: "Pair a device" on a tab already in a session issues a code
  for *that* session (n-device pairing falls out for free, capped at 16).

### 4.5 Abuse resistance (why 6 characters is enough)

30 bits is guessable in the abstract; it is protected by process, not
entropy: 5-minute TTL, single use, **claim rate limits** (per-IP: 10
claims/min at the worker; global: PairingDO rejects when >100 claims/s), and
a per-code attempt counter (a code with 10 failed... n/a — claims name a code;
a *wrong* code is just a miss, so the limit that matters is per-IP+global).
With ≤ ~100 codes live at any moment, one guess hits with p ≈ 10⁻⁷; a
maxed-out attacker inside the rate limit expects centuries per hit, and a hit
yields edit access to one stranger's mug dimensions for one session. Codes
are compared constant-time; misses return a uniform error (no oracle for
"code exists but expired").

## 5. Wire protocol

JSON text frames, `protocolVersion: 1` in `hello`. Unknown kinds/fields are
ignored (same forgiving posture as share-link parsing).

Client → server (SessionDO socket):

| kind | payload | notes |
|---|---|---|
| `hello` | `{protocolVersion, clientId, actor}` | `actor`: `"human"` \| `"agent"`; `clientId`: random per-tab, stable across reconnects |
| `patch` | `{patchId, baseVersion, patches: SharePatches}` | debounced local diff (§6.2) |
| `mint_code` | `{}` | reply: `code {code, expiresAt}`; registers with PairingDO |
| `bye` | `{}` | best-effort clean leave on `pagehide` |

Server → client:

| kind | payload | notes |
|---|---|---|
| `welcome` | `{state, version, peers}` | full snapshot on (re)join |
| `patch` | `{version, patches, clientId, actor}` | a peer's accepted patch; sender drops its own echo by `clientId` |
| `resync` | `{state, version}` | on detected gap or request |
| `presence` | `{peers}` | count + actors, on join/leave |
| `code` | `{code, expiresAt}` | reply to `mint_code` |
| `error` | `{code, message}` | terminal errors close the socket |

HTTP (worker):

- `POST /api/pair/claim` `{code}` → `{sid}` or uniform failure. The **only**
  place a `sid` crosses to a client; the client uses it solely to open
  `GET /api/session/:sid/ws` and to persist `unfolded:session:v1`.

Versioning is for **gap detection only** (a client seeing
`version > lastSeen + 1` requests `resync`). Patches are never rejected as
stale — merging is per-field LWW (§6.3).

## 6. Sync semantics (carried from v1, unchanged in substance)

### 6.1 Server state & the normalization problem

`updateForm` is not a plain merge: it flares the top when taper turns on and
mirrors top←bottom for straight forms (`useProjectStore.ts`). A naively
merging DO would diverge from every client and each `welcome`/`resync` would
"correct" them wrongly. **Resolution:** extract the pure patch application
(normalize → merge → taper/mirror rules) into `src/lib/model/applyPatch.ts`,
used by **both** the store's `updateForm` and the DO. One implementation, two
callers; prerequisite work item 1, valuable standalone. The DO validates every
patch with the same zod schemas before applying; invalid → `error`, state
untouched (mirroring the tools' `isError` posture).

### 6.2 Publisher (local edits → out)

The `persistence.ts` pattern: subscribe to the design slice, debounce ~250 ms,
diff against `lastSyncedState`, send only changed fields as `SharePatches`,
advance `lastSyncedState` on send. Diffing *state* covers every mutation path
— sliders, agent tools, presets, `open_model`, undo/redo — with no action
instrumentation.

### 6.3 Receiver & echo suppression

On a peer's `patch`: apply via `openModel(patches)` (validated, one undo step
via its coalescing scope), then set `lastSyncedState` to the result in the
same synchronous frame so the publisher's next diff is empty. Self-echoes drop
by `clientId`. Field-level LWW: simultaneous edits to different fields both
win; same-field races resolve to the later arrival, and the loser *sees* the
winning value within a second.

### 6.4 Undo across devices

Remote patches enter local undo history as ordinary steps, preserving "human
and agent are peers": undo on the desktop reverts the phone agent's last edit
locally, and the publisher broadcasts the reversion as a normal patch, so all
devices converge. Accepted quirk: two devices undoing "the same" step
double-revert; convergence still holds because everything is state-diff
patches.

### 6.5 Reconnection & offline

Exponential backoff (1 s → 30 s, jittered); reconnect also on
`visibilitychange`→visible, `online`, `focus` — mobile Chrome freezes
background sockets, so every return to the phone tab is a resync. On
`welcome` after a gap: apply server state, then send surviving local edits as
one diff (per-field local-wins for offline edits, documented LWW). Pending
patches while disconnected collapse into the diff for free. A claimed-then
unreachable session (claim OK, WS fails) rolls back to unpaired with a toast.

### 6.6 Presence UI

The three-state agent pill's semantics are **frozen** — sync must not become
a fourth `agentStatus`. A separate small indicator: nothing when unpaired;
"syncing" (grey) while connecting; "n devices" (green) when ≥2. States only
what the socket confirms.

## 7. WebMCP tool surface change

One new tool, `join_session` — registered like the others in
`src/mcp/tools.ts`, with entries added to `TOOL_SUMMARIES`, the README table,
the `/webmcp` page (renders from `TOOL_SUMMARIES`), and the e2e
`EXPECTED_TOOLS` (updated deliberately — it is the independent contract
check). This changes the frozen tool surface, so it waits for the freeze to
lift.

- **`join_session`** — *"Pair this tab into a live session using the
  6-character code shown on the potter's other device."*
  - input: `{code: string}` (zod: trimmed, separators stripped, uppercased,
    `/^[A-HJ-NP-Z2-9]{6}$/`)
  - annotations: `{title: "Join live session", idempotentHint: false}`
  - behavior: claim → connect → adopt session state; success returns the full
    new state (as every mutating tool does) prefixed with
    `"Joined live session — now syncing with N other device(s)."`; failure
    returns `isError` with the unchanged state and the uniform message
    `"That code didn't work — codes expire after 5 minutes and can be used
    once. Ask the potter to mint a fresh one."`
  - description tells the agent when to use it: the potter says "join my
    desktop/other session" and dictates a code.

Everything else stays: the agent needs no tool to *sync* (transparent under
the store) and none to mint (the desktop UI mints; agent-minted codes are a
stretch item, §12).

## 8. Server implementation

- `wrangler.jsonc`: `durable_objects` bindings `SESSION` → `SessionDO`,
  `PAIRING` → `PairingDO`; `migrations` with `new_sqlite_classes` (free-tier
  compatible); `/api/*` handled in the worker before assets (already
  `run_worker_first: true`).
- Worker (`worker.js` → `worker/index.ts`, TS so it can import the shared
  schemas and `applyPatch`; wrangler bundles): routes
  `POST /api/pair/claim` (per-IP rate limit here) and
  `GET /api/session/:sid/ws` (validate `sid` shape → `idFromName(sid)` →
  forward upgrade); everything else falls through to the www-redirect +
  assets behavior exactly as today.
- `SessionDO`: hibernation-aware; storage `state`, `version`, `updatedAt`;
  alarm deletes storage after 30 idle days. `mint_code` calls `PairingDO`.
- `PairingDO`: in-storage code table with TTL sweep by alarm; global claim
  throttle; constant-time compare; uniform miss responses.
- Limits: frame ≤ 8 KB, ≤ 16 sockets/session, ≤ 20 msg/s/socket → `error` +
  close. All input zod-validated; unknown ignored.

## 9. Privacy & security review

- **What leaves the device (new):** the design slice, coarse presence (actor
  kind, tab count), and — only during pairing — a 6-character code. No names,
  no chat content, no user agent stored. README privacy copy updated (item 9).
- **v2's win over v1:** no URL is ever a live capability. Share links, the
  address bar, the printed QR, and agent-returned `shareUrl`s are all exactly
  as inert as today; a leaked chat transcript holds at worst an expired code.
- **Residual threats:** shoulder-surfing an unclaimed code (5-min window,
  visible countdown, potter sees "2 devices" appear); a paired device lost or
  stolen (unpair by... any device can't evict peers in v1 — mint nothing,
  stop using the session; eviction is a stretch item); brute force (§4.5);
  malicious peer garbage (schemas + clamps); valid-but-unwanted edits
  (inherent to pairing — undo works, sessions are abandonable, idle-expire).
- **The `sid` is still the real key** — 128-bit, known to server and paired
  clients' localStorage only. The code is a 5-minute front door to it.

## 10. Testing

- **Unit (pure):** `applyPatch.ts` parity with today's store behavior
  (table-driven against current `updateForm` cases); diff/merge + echo
  bookkeeping; code normalization/format.
- **DO tests (`@cloudflare/vitest-pool-workers`):** mint→claim→burn (second
  claim fails uniformly), TTL expiry, rate-limit rejection, two-socket
  fan-out, gap → resync, alarm deletion.
- **e2e (extend `e2e/run.mjs`):** build + `wrangler dev`; context A mints via
  UI, context B joins via `__unfoldedTools.join_session.execute({code})`;
  drive `set_capacity` in B, poll A until `capacityMl` matches; edit in A,
  assert B; offline/reconnect convergence; expired-code `isError` path.
- **Contract guards:** tool-surface test (`TOOL_SUMMARIES` ↔ `buildTools`)
  already fails the build if `join_session` misses its summary; a no-`/api`
  boot test asserts the app degrades to today's behavior.

## 11. Work items (ordered; each ships alone, green gates as in refactor-spec)

1. **`applyPatch.ts` extraction** — store behavior byte-identical (existing
   store tests unchanged). *Prerequisite; valuable standalone.*
2. **`syncClient.ts` core (no UI, no pairing)** — connect/hello/welcome,
   publisher diff, receiver apply, echo suppression; enabled only when
   `unfolded:session:v1` exists. Accept: unit tests; app unchanged otherwise.
3. **`SessionDO` + worker routing + wrangler config.** Accept: DO tests;
   `wrangler dev` serves app + `/api`.
4. **`PairingDO` + mint/claim + limits.** Accept: DO tests incl. burn/TTL.
5. **Pairing UI** — "Pair a device" dialog (code display + countdown + manual
   entry + unpair), localStorage rejoin. Accept: human-to-human pairing works
   end to end with no agent.
6. **`join_session` tool** + `TOOL_SUMMARIES`/README/e2e `EXPECTED_TOOLS`
   updates. Accept: primary flow (§4.2) via `__unfoldedTools`; e2e two-context
   test.
7. **Reconnect/resync/offline queue.** Accept: e2e offline scenario.
8. **Presence indicator.**
9. **Docs** — README privacy + pairing section; `/webmcp` page copy.

Estimate: ~700 LOC production + ~450 LOC tests. Items 1–2 are half the risk
and reviewable with no infrastructure.

## 12. Stretch (explicitly not in v1)

- **Agent-minted codes** (`start_pairing` tool: agent shows a code in chat,
  the potter types it on the desktop — the reverse direction; same claimer-
  adopts rule).
- Evicting a peer / rotating the `sid` from any device.
- Read-only join codes.
- Peer labels ("phone · agent active") in presence.
- Server-ordered shared undo history.

## 13. Design review

Reviewed against the codebase on 2026-08-31:

- **v2 vs v1, net:** pairing UX in chat is strictly better (no links, which
  ChatGPT breaks anyway; a code survives being spoken), and the capability
  story is strictly better (no live-capability URLs). The costs: a second DO,
  a claim endpoint, one new tool on a frozen-until-Sep-3 surface, and codes
  are weaker secrets than a 128-bit link — mitigated by process (§4.5), and
  the exposure window is 5 minutes versus a transcript's forever. Right
  trade.
- **Biggest real risk stays normalization drift (§6.1)** — unchanged from
  v1; item 1 first, alone, with parity tests.
- **PairingDO singleton is a global bottleneck** in theory; at this app's
  scale (claims are human-paced) it is nowhere near one, and it's what makes
  one-time-use actually atomic. Accepted.
- **`join_session` gives agents a claim path** — an agent could brute-force
  claims faster than a human. The worker's per-IP limit doesn't care who's
  calling; the tool adds client-side backoff after 3 failures for
  politeness, but the server limit is the guarantee.
- **LWW can drop a same-field concurrent edit** (§6.3) — accepted knowingly,
  as in v1: independent scalars, ~250 ms window, loser sees the winner.
- **`unit` syncs** — kept from v1 (paired devices disagreeing about display
  units would be more confusing than syncing a preference).
- **Claimer-adopts (§4.3) can surprise**: joining from a tab holding an
  unshared design replaces it. Mitigated: one undo step, and the dialog/tool
  copy says "this device will follow the session". Watch in testing.
- **What was cut and why:** identity (nothing to build it on — WebMCP passes
  none, by design); URLs as capabilities (v1's weakest point); shared undo
  (per-tab converges); CRDTs (state too small); a fourth pill state (frozen
  contract; sync ≠ agent connection).
- **Verdict:** sound to build as specced; sequencing unchanged — nothing
  before the Sep 3 freeze lifts, then items 1–2 immediately (pure TS, no
  infrastructure, worthwhile even if the backend never ships).

## Open questions (decide before item 4)

1. Code TTL 5 minutes — right for a spoken-through-agent round trip? (The
   agent may take 30–60 s to act; 5 min has slack, but confirm.)
2. Idle-session retention: 30 days?
3. Should "Pair a device" on a *never-synced* tab create the session eagerly
   (code works even if the desktop tab closes) or lazily (session exists only
   once claimed)? Leaning eager — simpler and matches the countdown promise.
