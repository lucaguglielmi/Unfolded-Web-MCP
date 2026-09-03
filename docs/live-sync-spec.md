# Live Sync specification

Status: implemented

Baseline: current main implementation at 1a2995d

Last verified: 2026-09-03 against the browser client, Worker, tests, and
WebMCP descriptions in this repository

This is the current protocol contract. It replaces the old v2/v3 planning
and amendment text that used to be mixed into this file. If a behavior is
not stated here or in the live-handoff specification, the source and tests
are authoritative.

## 1. Purpose

Live Sync lets two or more Unfolded tabs work on one design. A tab can
continue a design from a short-lived link, a six-character code, or the
human pairing dialog. Once joined, edits flow in both directions and are
visible to the next WebMCP read.

The feature is deliberately optional. A tab with no stored session is the
normal offline app: the design still loads, edits, undo, preview, and PDF
export work without a network connection.

## 2. Scope and non-goals

Live Sync owns:

- session creation and persistence;
- code and token claiming;
- WebSocket transport and server-side validation;
- presence, reconnect, wake-up, and offline reconciliation;
- the browser pairing UI and printed parameter-only QR.

Live Sync does not make a design URL a session capability. A permanent
design link contains model parameters only. A live handoff link may contain
one short-lived join token; it never contains the session id.

The protocol is not a CRDT and does not promise causal or character-level
merging. Patches are validated field updates with server arrival order.

## 3. Session model

The Worker routes one Durable Object to each session id. A session stores
only the design slice and a monotonically increasing version:

    state = {
      form,
      clay,
      paperSize,
      unit
    }

The client creates a 128-bit, URL-safe session id. It persists the id and
the whether-ever-peered flag under localStorage key
unfolded:session:v1. The id is not put in a design URL or returned as an
invitation.

The session Durable Object persists its canonical state, version, and
small lifecycle metadata. It deletes the stored session after 30 days with
no open sockets. It accepts at most 16 simultaneous sockets.

## 4. Pairing credentials

### 4.1 Six-character code

- Alphabet: ABCDEFGHJKMNPQRSTUVWXYZ23456789.
- I, L, O, 0, and 1 are excluded.
- Six glyphs are generated from crypto randomness without modulo bias.
- Display formatting groups the code as three glyphs, a dash, and three
  glyphs.
- A code expires after 15 minutes and is burned by its first successful
  claim.
- Unknown, expired, malformed, and already-used codes are indistinguishable
  invalid claims.

Claims are limited to 10 per IP per minute and 100 globally per second in
production. A development-only environment setting can raise the per-IP
limit for local end-to-end tests where all browser contexts share one
address.

### 4.2 Join token

- The token is 24 crypto-random bytes encoded as base64url.
- It is accepted only in the token character range of 20 to 64 characters.
- It expires after 15 minutes and is burned by its first successful claim.
- It resolves to the session id server-side; the token itself never names
  the session.
- A token is used in a live handoff link or the human Continue dialog.

Codes and tokens use the same pairing Durable Object table and claim
limits. The HTTP claim endpoint is POST /api/pair/claim with a JSON body
whose `code` value is either the six-character code or the URL join token.
A successful response contains ok and sid. A miss is returned as a 404
with ok and retryable; rate-limited misses remain retryable, while invalid
misses do not.

## 5. Pairing flows

### 5.1 Create or start a session

The first tab can create a session eagerly. It sends its complete current
design on the first hello, so a newly created session starts from that
design rather than the default mug.

The WebMCP create_live_handoff tool mints a token for the current session.
The start_pairing tool mints a code and a token in parallel and returns the
code plus the optional live handoff link. The human Continue dialog uses
the same pair of invitations.

### 5.2 Join

The opening tab claims the code or token, stores the resolved session id,
marks the tab as having joined, and starts a WebSocket. The first welcome
contains the canonical session snapshot. The joining tab adopts that
snapshot as one undoable model change; after that, neither tab is special.

The URL boot path first hydrates the parameter snapshot, marks any
via=chatgpt provenance, removes join from the address bar, and then claims
the token. A claimed token replaces the initial snapshot with the session's
canonical welcome; an expired or invalid token leaves a usable design URL
with no live capability.

The join_session WebMCP tool is the code-entry path for an agent. It
accepts a six-character code after case and separator normalization. A
failed or cancelled claim leaves the current tab and its stored session
unchanged.

### 5.3 Direction

Pair on the device whose design should be adopted by the other device:

- mint on the agent or browser that owns the desired design;
- open the link or enter the code on the device that should adopt it.

This direction applies only at first join. Once both tabs are peers, edits
flow both ways.

## 6. URLs and printed QR

### 6.1 Permanent design URL

The permanent URL is a parameter serialization of form, clay, paper, and
display-unit settings. It is suitable for bookmarks, independent copies,
the address bar, and printed paper. It carries no session access.

The address bar follows the current design parameters. If a live handoff
was opened with via=chatgpt, that provenance marker may remain; join is
removed. The address bar is never a substitute for a live handoff link.

### 6.2 Printed QR placement

The PDF QR is always the parameter-only design URL. It is drawn on the
overview page and, where geometry allows, inside the largest template
piece:

- QR square: 22 mm;
- caption block: two lines below the square;
- inside placement keeps 8 mm clear of cut, fold, and annotation content;
- the QR must fit entirely on one printed tile;
- if the piece has no safe location, the exporter tries an outside
  placement with a 4 mm gap and a keep-tab;
- if no template location is safe, the overview QR remains the only one.

The QR is intentionally not a live-session capability because printed
paper outlives a chat invitation.

## 7. Client synchronization

### 7.1 Connection lifecycle

The client is inert until a session id is stored. start reconnects a stored
session; stop disconnects but keeps the record; unpair disconnects and
forgets it. pair creates a session id if needed and connects.

The client sends a hello after each socket opens. A hello may include the
local design for first-contact bootstrap. A wake event from focus,
visibility, or online status reconnects a lost socket or sends a hello
probe to a socket that appears open.

Reconnect waits use a jittered backoff from 1 second to 30 seconds.
Ordinary local edits are debounced for 250 ms before a patch is sent.

### 7.2 Snapshot and patch handling

The design slice is exactly form, clay, paperSize, and unit. It uses the
same SharePatches vocabulary and validation path as share links and local
model updates.

On welcome or resync:

1. adopt the server snapshot;
2. reapply local edits made while disconnected;
3. reapply sends that were not acknowledged by the old socket;
4. flush the remaining local delta.

For a normal peer patch, apply the sanitized patch locally and advance the
server version. An echoed patch from this tab advances the version and
acknowledges its patch id without applying the patch a second time.

Each field is last-write-wins by server arrival order. Concurrent changes
to different fields both survive. Concurrent changes to the same field are
resolved by whichever validated patch the server processes later.

### 7.3 Version gaps and invalid patches

The server increments the version for every accepted patch and broadcasts
the sanitized patch to every socket, including the sender. If a client sees
a version gap, it sends one fresh hello and waits for a full snapshot.

An invalid patch changes neither canonical state nor version. The server
sends invalid_patch to the sender; the client drops the oldest unacknowledged
send and requests a resync.

## 8. WebMCP integration

The app exposes the full session state in every state-reporting tool result:

    session: {
      paired: boolean,
      peers: number
    }

Snapshots are pure. Reading or reporting state never mints or spends a
token. The separate link contract is documented in
live-handoff-link-spec.md.

When the tab is unpaired, describe_project tells an agent to offer
create_live_handoff first and the six-character code second. A handoff
failure still leaves the code route available; it never authorizes the
agent to substitute the address-bar URL.

## 9. Browser UI and lifecycle

The header connection control opens Continue on another screen. The dialog
shows a QR, copyable live link, and six-character code together. Code entry
is available behind the join toggle. When another peer is confirmed, the
invitation display is cleared.

Clipboard detection recognizes a pasted or copied live link or code and
offers a one-tap join. It never joins automatically and excludes an invite
minted by the same tab.

If a session has never seen a second device, the client keeps its eagerly
created session for a 16-minute solo grace period, long enough for the
15-minute invitation to be used. A suspended mobile tab is given probation
after wake so a late timer cannot delete a session before its resync. Once
another device has joined, the everPeered flag prevents this solo cleanup.

Offline local edits are retained across a disconnect and reapplied on top
of the next server snapshot. The server's stored session expires only
after 30 days without an open socket.

## 10. Wire protocol

Protocol version is 1. The WebSocket endpoint is
/api/session/{sid}/ws.

Client-to-server frames:

| Kind | Fields | Meaning |
| --- | --- | --- |
| hello | protocolVersion, clientId, actor, optional state | identify the client and optionally bootstrap or request a snapshot |
| patch | patchId, baseVersion, patches | submit a SharePatches update |
| mint_code | none | request a code for this session |
| mint_token | none | request a join token for this session |
| bye | none | close this client socket |

Server-to-client frames:

| Kind | Fields | Meaning |
| --- | --- | --- |
| welcome | state, version, peers | first response or response to hello |
| patch | version, patches, clientId, actor, optional patchId | accepted patch broadcast to all sockets |
| resync | state, version | reserved full-snapshot response shape |
| presence | peers | current socket count |
| code | code, expiresAt | minted code |
| token | token, expiresAt | minted join token |
| error | code, message | protocol, patch, or mint failure |

hello accepts actor human or agent and a clientId no longer than 64
characters. The server accepts text frames up to 8 KiB and at most 20
messages per socket per second. Unknown JSON kinds and malformed JSON are
ignored; oversized or non-text frames and invalid hello frames close the
socket with a protocol error. Invalid patches return invalid_patch without
changing canonical state, and the client requests a fresh welcome.

## 11. Worker contract

The Worker:

1. redirects www to the canonical hostname;
2. checks the browser Origin for API requests;
3. routes session WebSockets to the Session Durable Object;
4. routes pairing claims to the global Pairing Durable Object;
5. serves static assets with the normal security headers.

An Origin header is accepted only when its hostname equals the request
hostname. Requests without Origin are allowed for non-browser clients and
tests; capability secrecy and single-use credentials remain the protection
for those clients.

The Session Durable Object persists state after accepted patches and socket
changes. WebSocket responses with status 101 pass through without HTTP
security headers; all other Worker responses receive the configured
security headers.

## 12. Security and privacy

- session ids, tokens, and code records are never listed or placed in
  design URLs;
- tokens and codes are short-lived and single-use;
- invalid and expired claims do not reveal whether a record existed;
- mismatched browser origins cannot use the API;
- server-side patches are sanitized and validated before broadcast;
- session state contains the design slice, not chat content or document
  bodies;
- a permanent URL or printed QR can be shared without granting live access.

This protocol does not protect a live session from a party that already
possesses a valid unspent invitation. Treat a live handoff link or code as
a bearer capability until it is claimed or expires.

## 13. Tests and acceptance

The behavior is covered by unit tests for:

- code/token generation, normalization, TTL, single-use claims, and rate
  limits;
- SessionCore bootstrap, patch validation, versions, and snapshots;
- client persistence, pairing direction, reconnect, wake, offline edits,
  gaps, cancellation, and solo cleanup;
- handoff and pairing WebMCP results;
- QR placement and PDF export.

The acceptance conditions are:

1. an unpaired tab remains fully usable without the sync Worker;
2. a minted invitation opens the intended design and creates a live peer;
3. the first peer's complete design bootstraps an eager session;
4. edits converge in both directions and remain undoable;
5. a stale or invalid invitation cannot create a session;
6. no state read or failed handoff leaks a live capability;
7. reconnect and offline edits do not silently discard local work.

Browser and Worker end-to-end checks are environment-dependent. The CI
workflow installs Chromium and runs the Worker smoke gate; local validation
must report unavailable browser binaries or network approvals rather than
calling those checks passed.

## 14. Source of truth

The implementation files are:

- src/store/syncClient.ts for browser lifecycle and reconciliation;
- src/lib/model/shareLink.ts for parameter links and SharePatches;
- src/mcp/liveHandoff.ts and src/mcp/tools.ts for agent-facing flows;
- worker/pairingCore.ts for credentials and claims;
- worker/sessionCore.ts and worker/sessionDO.ts for canonical state;
- worker/index.ts and worker/originCheck.ts for routing and origin checks;
- src/lib/export/qrPlacement.ts and src/lib/export/pdf.ts for printed QR.

If this document and the tests disagree with the code, fix the contract
and tests together. Do not revive the superseded amendment text.
