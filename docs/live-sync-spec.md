# Live Sync Spec — Option 2: WebSocket session layer (Durable Object)

Status: **draft — not started**. This document specifies cross-device live sync
("edit on the phone with the agent, watch the desktop update"), reviews its own
design, and lists what is deliberately cut. Nothing here is implemented.

**Deadline context:** `docs/refactor-spec.md` freezes features until the WebMCP
Challenge submission (Sep 3). This entire spec is **post-deadline work** — it
adds a backend, which is the largest architectural change the project can make,
and must not land before submission.

## 1. Problem

WebMCP is tab-scoped: the agent in Chrome-with-flag on a phone mutates that
tab's zustand store only. All persistence today is local to the device
(address-bar share link, `localStorage`). The only cross-device bridge is a
share link — exact, but manual and snapshot-only. Goal: when any actor (human
or agent, on any paired device) edits the design, every paired tab reflects it
within ~1 s, bidirectionally.

## 2. Non-goals (v1)

- **Shared cross-device undo history.** Undo stays per-tab (see §6.4 — it
  still behaves sanely across devices without a server-side history).
- **Multi-user collaboration semantics** (cursors, names, permissions). The
  session is a capability link, not an account system.
- **Offline-first merging beyond per-field last-write-wins.** The state is a
  dozen scalars; CRDTs are not warranted.
- **Syncing agent status, export state, or history** — only the design slice
  `{form, clay, paperSize, unit}` syncs (the same slice `persistence.ts`
  persists).
- **A new WebMCP tool.** The primary flow needs none (§7). `start_live_sync`
  as an agent-mintable pairing link is a stretch item (§12).

## 3. Architecture overview

```
phone tab ──ws──▶ ┌─────────────────────────┐ ◀──ws── desktop tab
 (agent edits)    │ SessionDO (one per sid) │
                  │  canonical state+version │
                  │  validates, merges, fans │
                  └─────────────────────────┘
```

- One **Durable Object per session** (`SessionDO`), addressed by an
  unguessable session id (`sid`), holding the canonical design state and a
  monotonically increasing `version`. Uses the **WebSocket Hibernation API**
  so idle sessions cost nothing.
- Tabs connect over WebSocket, send **patches** (not full snapshots), receive
  everyone's patches plus resync snapshots.
- The wire format for a patch **is `SharePatches`** — the exact shape
  `parseShareParams` already produces and `openModel` already consumes. No new
  design vocabulary; the share-link contract stays the single model contract.
- **Progressive enhancement:** if `/api/*` is absent (plain `vite dev`, a
  static mirror on another origin), the sync module silently stays off and the
  app is exactly today's app. Origin-independence of the *app* is preserved;
  only live sync is origin-bound.

## 4. Session identity & pairing

- `sid`: 128 bits, crypto-random, base58 (~22 chars). Client-generated; the DO
  is created lazily on first connect. Unguessable id = the capability. There is
  no listing endpoint and no index.
- **A link containing `sid` is an edit capability.** Anyone holding it can join
  and edit the live session. The plain share link (no `sid`) remains the safe,
  inert way to share a design.
- Pairing UX: the Share dialog gains a **"Sync live between devices"** toggle.
  Enabling it mints a `sid`, appends `&sid=…` to the copied link and QR, and
  connects this tab. Opening any link with `sid` joins that session (after
  applying the link's design params as today). The address-bar sync
  (`urlSync.ts`) carries `sid` while active so refresh rejoins.
- The **printed PDF QR stays untagged** (no `sid`) — it already deliberately
  outlives any chat session; it must not become a long-lived edit capability.
- Old clients ignore `sid` (unknown keys are dropped by `parseShareParams`),
  so the frozen share-link contract is untouched.

## 5. Wire protocol

JSON text frames, one message per frame, `protocolVersion: 1` in `hello`.
Unknown message kinds and unknown fields are ignored (same forgiving posture
as share-link parsing).

Client → server:

| kind | payload | notes |
|---|---|---|
| `hello` | `{protocolVersion, clientId, actor}` | `actor`: `"human"` \| `"agent"`; `clientId`: random per-tab id, stable across reconnects of the same tab |
| `patch` | `{patchId, baseVersion, patches: SharePatches}` | debounced local diff (§6.2) |
| `bye` | `{}` | clean leave (best effort, on `pagehide`) |

Server → client:

| kind | payload | notes |
|---|---|---|
| `welcome` | `{state, version, peers}` | full snapshot on (re)join; `state` is the complete design slice |
| `patch` | `{version, patches, clientId, actor}` | a peer's accepted patch; `clientId` lets the sender ignore its own echo |
| `resync` | `{state, version}` | server-initiated full snapshot (gap detected, or on request) |
| `presence` | `{peers}` | `peers`: count + actors, sent on join/leave |
| `error` | `{code, message}` | terminal errors close the socket |

Versioning is for **gap detection only**: each broadcast carries the new
`version`; a client that receives `version > lastSeen + 1` requests `resync`.
Patches are never rejected for staleness — merging is per-field LWW (§6.3).

## 6. Semantics

### 6.1 Server state & the normalization problem

`updateForm` is not a plain merge: it flares the top when taper turns on and
mirrors top←bottom for straight forms (`useProjectStore.ts`). If the DO merged
patches naively, its canonical state would diverge from what every client
computes, and each `welcome`/`resync` would "correct" clients wrongly.

**Resolution:** extract the pure form-patch application (normalize → merge →
taper/mirror rules) from the store into `src/lib/model/applyPatch.ts`, used by
**both** the store's `updateForm` and the DO. One implementation, two callers;
the store keeps only history/undo wiring around it. This is a prerequisite
refactor with its own tests (work item 1) and is worth having regardless of
sync.

The DO validates every incoming patch with the **same zod schemas**
(`updateFormInputSchema`, `setClayInputSchema`) before applying. Invalid →
`error`, state untouched — mirroring the tools' `isError` posture.

### 6.2 Publisher (local edits → out)

Reuse the `persistence.ts` pattern: subscribe to the design slice with
`subscribeWithSelector`, debounce ~250 ms, then diff current state against
`lastSyncedState` and send only changed fields as `SharePatches`. On send,
advance `lastSyncedState`. Because the publisher diffs *state*, every mutation
path is covered automatically — sliders, agent tools, presets, `open_model`,
undo/redo — with no instrumentation of actions.

### 6.3 Receiver (remote patches → in) & echo suppression

On `patch` from a peer: apply through `openModel(patches)` (validated, one
undo step via its existing coalescing scope), then set `lastSyncedState` to
the resulting state **in the same synchronous frame**, so the publisher's next
diff is empty. Self-echoes are dropped by `clientId` before applying.
Concurrent local edits during the same debounce window survive: they differ
from the updated `lastSyncedState` and go out on the next tick. Field-level
LWW means simultaneous edits to *different* fields both win; simultaneous
edits to the *same* field resolve to the later arrival — acceptable for scalar
design parameters, and the loser sees the winning value within a second.

### 6.4 Undo across devices

Remote patches enter the local undo history as ordinary steps (through
`openModel`), preserving the app's "human and agent are peers" rule: undo on
the desktop can revert an edit the phone's agent just made — locally — and the
publisher then broadcasts that reversion as a normal patch, so all devices
converge. No server-side history needed. Known quirk, accepted for v1: two
devices undoing "the same" step double-revert; convergence is still guaranteed
because everything is state-diff patches.

### 6.5 Reconnection & offline

- Exponential backoff (1 s → 30 s cap, jittered); also reconnect on
  `visibilitychange`→visible, `online`, and `focus` — mobile Chrome freezes
  background-tab sockets, so **every return to the phone tab is a resync**.
- On `welcome` after a gap: apply server state, then diff local
  pre-reconnect state against it and send surviving local edits as one patch
  (local wins per-field for fields edited while offline — documented LWW).
- Outgoing patches while disconnected collapse into the pending diff (it's a
  diff against `lastSyncedState`, so queuing is free).

### 6.6 Presence UI

The three-state agent pill's semantics are **frozen** (refactor-spec ground
rules) — sync must not become a fourth `agentStatus`. Add a separate, small
indicator next to it: nothing when sync is off; "syncing" (grey) while
connecting; "n devices" (green) when ≥2 peers. Tooltip explains the
capability-link model. Honest like the pill: it states only what the socket
confirms.

## 7. Primary user flow (acceptance scenario)

1. Desktop: open the app, toggle "Sync live", scan the QR with the phone.
2. Phone (Chrome + `#enable-webmcp-testing`): link opens the same design,
   joins the session; both tabs show "2 devices".
3. Phone: ask the agent *"make it hold 350 ml"* → `set_capacity` runs in the
   phone tab → patch → DO → desktop preview updates in <1 s.
4. Desktop: drag the shrinkage slider → phone updates; the agent's next
   `describe_project` on the phone reports the new shrinkage.
5. Kill the phone's network for 30 s, edit on desktop, restore: phone
   resyncs on its own.

No new WebMCP tool is required: the agent operates on the phone tab as today;
sync is transparent under it.

## 8. Server implementation

- `wrangler.jsonc`: add `durable_objects` binding `SESSION` → `SessionDO`,
  `migrations` (`new_sqlite_classes` — free-tier compatible), and route
  `/api/session/*` handled in the worker before assets (already
  `run_worker_first: true`).
- Worker (`worker.js` → `worker/index.ts`, TS so it can import the shared
  schemas; wrangler bundles it): `GET /api/session/:sid/ws` → validate `sid`
  shape → `env.SESSION.idFromName(sid)` → forward the upgrade. Everything
  else falls through to assets/redirect as today.
- `SessionDO`: hibernation-aware (`state.acceptWebSocket`,
  `webSocketMessage`, auto-ping); storage keys `state`, `version`,
  `updatedAt`. An **alarm deletes storage after 30 days idle** (retention
  policy; the state is only design parameters — no PII — but we still don't
  keep it forever).
- Limits: max frame 8 KB, max 16 sockets/session, ≥20 msg/s per socket →
  close with `error`. All input zod-validated; unknown ignored.

## 9. Privacy & security review

- **What leaves the device (new):** the design slice and coarse presence
  (actor kind, tab count). No names, no chat content, no user agent stored.
  README's privacy story must be updated honestly (work item 8).
- **Threats & answers:** guessing `sid` (128-bit random — infeasible);
  spraying connects (per-IP upgrade rate limit in the worker; sockets/session
  cap); malicious peer sends garbage (schemas + clamps, same as share links);
  malicious peer sends *valid* destructive edits (inherent to a capability
  link — mitigations: undo still works, plain share links stay inert, dialog
  copy says "anyone with this link can edit live"); storage abuse (state is
  ≤1 KB; idle deletion).
- **The `shareUrl` in tool results**: while a session is active it SHOULD
  carry `sid` (an agent handing the potter a link that joins the live session
  is the point), **except** the PDF QR (§4). This slightly widens what a
  pasted-into-chat link can do; the chat transcript then holds an edit
  capability. Accepted: transcripts already hold the full design; sessions
  can be abandoned by minting a new `sid`; idle sessions expire.

## 10. Testing

- **Unit (vitest, pure):** `applyPatch.ts` (normalization parity with today's
  store behavior — table-driven against the current `updateForm` cases);
  diff/merge module (`diffDesign`, LWW merge, echo suppression bookkeeping).
- **DO tests:** `@cloudflare/vitest-pool-workers` — connect two mock sockets,
  assert fan-out, version gaps → resync, validation rejections, alarm
  deletion.
- **e2e (extend `e2e/run.mjs`):** build + `wrangler dev`; two Chromium
  contexts join one `sid`; drive `__unfoldedTools.set_capacity` in context A,
  poll context B's store until `capacityMl` matches; then edit in B and
  assert A. Also: B offline → A edits → B online → converged.
- **Contract guard:** a test asserting the sync module is a no-op (and the
  app boots clean) when `/api` is unreachable.

## 11. Work items (ordered; each ships alone, green gates as in refactor-spec)

1. **`applyPatch.ts` extraction** — pure form/clay patch application shared by
   store and (later) DO; store behavior byte-identical (existing store tests
   unchanged). *Prerequisite; valuable standalone.*
2. **`syncClient.ts` core (no UI)** — connect/hello/welcome, publisher diff,
   receiver apply, echo suppression; enabled only when `sid` present.
   Accept: unit tests for diff/echo; app unchanged without `sid`.
3. **`SessionDO` + worker routing + wrangler config.** Accept: DO tests green;
   `wrangler dev` serves app + `/api`.
4. **Reconnect/resync/offline queue.** Accept: e2e offline scenario.
5. **Pairing UI** — Share-dialog toggle, `sid` in address-bar sync, QR.
   Accept: primary flow (§7) manually verified + e2e two-context test.
6. **Presence indicator.** Accept: shows only socket-confirmed facts.
7. **Limits, retention alarm, per-IP upgrade rate limit.**
8. **Docs** — README privacy + "Sync live" section; update `/webmcp` page copy.

Estimate: ~600 LOC production + ~400 LOC tests across items; items 1–2 are
half the risk and reviewable without any infrastructure.

## 12. Stretch (explicitly not in v1)

- `start_live_sync` WebMCP tool (agent mints the pairing link from chat).
- Server-ordered shared undo history.
- Read-only join mode (`sid` + `ro=1` capability split).
- Peer labels ("phone · agent active") in presence.

## 13. Design review (what's weak, and why it's accepted)

Reviewed against the codebase on 2026-08-31:

- **Biggest real risk: normalization drift (§6.1).** If `applyPatch.ts`
  extraction misses a store subtlety (taper flare threshold, the 0.05 mm
  epsilon, legacy-patch normalization), server resyncs will fight clients.
  That's why item 1 ships first, alone, with table-driven parity tests, and
  why the DO reuses the module rather than reimplementing.
- **LWW can drop a same-field concurrent edit** (§6.3). Accepted knowingly:
  fields are independent scalars, the window is ~250 ms + RTT, and the loser
  *sees* the winning value immediately — unlike Option 1's silent whole-state
  clobber. Revisit only if real usage shows collisions.
- **`unit` syncs across devices.** Debatable (it's a display preference), but
  it already rides share links and the PDF prints in it, so two paired
  devices disagreeing would be more confusing than syncing it. Decision:
  sync it; keep it out of undo history as today.
- **Duplicated environment risk:** schemas now run in the Worker too; a
  deploy that skews client vs. DO could mis-validate for the seconds between
  asset and worker rollout (single deploy unit in practice — wrangler ships
  both together, so this is theoretical).
- **Cost/plan:** SQLite-backed DOs work on the free tier; sustained use wants
  the paid Workers plan. Fine for a demo-scale app; no per-user cost model
  needed while sessions are ephemeral and stateless beyond 1 KB.
- **What was cut and why:** server-side shared undo (the one genuinely hard
  problem — redo semantics after remote edits — and §6.4 shows per-tab undo
  converges anyway); CRDTs (state too small); auth/accounts (capability link
  matches the app's no-login philosophy); a fourth pill state (frozen
  contract, and sync ≠ agent connection).
- **Verdict:** sound to build as specced. Sequencing note: do not start
  before the Sep 3 submission freeze; afterwards items 1–2 are low-risk pure
  TypeScript and worth doing even if the backend is never deployed (item 1 is
  a quality win; item 2 is testable without infrastructure).

## Open questions (decide before item 3)

1. Should joining a `sid` link **adopt the link's design or the session's
   current state** when they differ? Spec currently: apply link params first,
   then `welcome` overwrites — i.e. the session wins. Alternative: the link's
   params are sent as a patch after welcome (the link wins). Session-wins is
   less surprising for "rejoin from history"; link-wins is better for "agent
   says: open this exact revision". Leaning session-wins.
2. Retention: 30 days idle — right number?
3. Does the "Sync live" toggle persist across visits (localStorage) or is a
   session deliberately per-visit?
