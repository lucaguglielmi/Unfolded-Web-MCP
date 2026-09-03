# One Continue: under the hood and the agent surface

> **Status: exploration only — NOT approved, NOT scheduled, do not
> implement.** This document explores an idea. It is not a source of
> requirements. The repository owner has not decided whether to build it.
> If that decision is ever made, the content here is rewritten into the
> current specifications; nothing is built from this file directly.

Baseline: main at 7f336a4, read on 2026-09-03

Would amend if built: docs/live-sync-spec.md §§4, 5, 7, 8, 10;
docs/live-handoff-link-spec.md §§2–7; docs/webmcp-tool-performance-spec.md
§§2, 5, 6.1, 8, 11; src/pages/agentManifest.ts; the README tool table;
e2e expected tools; the docs guard.

Overview and plan: [unified-continue-overview.md](unified-continue-overview.md).
What the person sees: [unified-continue-ui.md](unified-continue-ui.md).

## 1. One primitive: pair

Internally there is one capability, **pair**, with two directions and two
counterparties:

| Direction | Counterparty | Today's path | Exploration's path |
| --- | --- | --- | --- |
| this tab invites | an agent | ChatGPT prompt with a code; `join_session` | the same, with the standing link first and the code second |
| this tab invites | a device | PairDialog token and code | the standing invitation, code on demand |
| this tab follows | an agent's tab | open `liveHandoffUrl` | open `continueUrl`, the same boot path |
| this tab follows | a device | type the code; open the Continue link; clipboard offer | unchanged |

The agent's tab and a person's tab are the same kind of client. What
differs is the `actor` each declares in its hello frame, which the
protocol already carries and the presence frame would begin to report.

## 2. The standing invitation

### 2.1 Definition

A session has at most one **standing invitation**: an unspent join token
with an expiry, held by the Session Durable Object and known to every
connected socket. It is created when the session first has a socket,
replaced when it is claimed, and replaced shortly before it expires. It
is never longer-lived or more reusable than today's tokens; it is simply
always there.

    invitation = {
      token,          // 24 crypto-random bytes, base64url, as today
      expiresAt       // epoch ms, 15 minutes from mint, as today
    }

The six-character code is deliberately **not** part of the standing
invitation. A code is minted only when a person expands the section that
shows it, or when the agent calls the explicit link tool. The reasoning:
a 30-bit code is protected by process rather than entropy, and keeping
one continuously live for every session widens the guessing window for
no benefit, since nobody types a code they cannot see.

### 2.2 Lifecycle in the Session Durable Object

1. On the first accepted hello for a session with no unspent invitation,
   the Session DO asks the Pairing DO to mint a token for its session id,
   stores `{ token, expiresAt }`, and includes it in the welcome.
2. Every later welcome includes the current invitation.
3. When the Pairing DO burns the token on a claim, it notifies the
   Session DO, which mints a replacement and broadcasts an `invitation`
   frame to every socket. Today the Pairing DO resolves a claim to a
   session id without telling the session; this is the one new call
   between the two objects.
4. An alarm at `expiresAt - 60 s` mints a replacement early so a client
   never holds a link with under a minute left. The old token stays valid
   until its own expiry; only the newest is advertised.
5. When the last socket closes, the invitation is left to expire. A
   session with no sockets does not keep rotating; the next hello mints
   a fresh one if needed.

The Pairing DO's table, alphabet, lifetimes, single use, uniform misses,
and rate limits are unchanged. `mint_token` as a client-to-server frame
becomes unnecessary and can be kept for one release for older tabs.

### 2.3 Lifecycle in the client

The sync client stores the latest invitation it has been told about and
exposes it:

    liveSync.invitation(): { token: string; expiresAt: number } | null

`null` means the tab has no session, the socket has not delivered a
welcome yet, or the last invitation expired without a replacement
arriving. A read is a memory read; it never sends a frame.

The client remembers each standing token in the minted-secrets set, as
it remembers minted tokens today, so the clipboard offer never proposes
the tab's own invitation back to it.

### 2.4 What the invitation is not

- Not a session id. The token resolves to one server-side, as today.
- Not multi-use. One claim burns it and a different one replaces it.
- Not in the address bar, the permanent link, or the printed QR.
- Not present in a tab that has no session. A plain visitor's snapshots
  carry no `continueUrl` and no false promise.

## 3. Presence by actor

The presence frame gains counts by the `actor` each socket declared:

    { kind: "presence", peers: 3, actors: { human: 2, agent: 1 } }

The welcome carries the same field. `peers` stays the total so existing
clients keep working; `actors` is additive. Protocol version stays 1
because a client that ignores the field loses nothing.

This is what lets the header control say *ChatGPT* instead of *2 devices*
when the second socket is the agent's tab, and what lets an agent's own
`describe_project` say whether a human screen is present. The `session`
field in state results becomes:

    session: { paired, peers, humans, agents }

`paired` keeps today's meaning. The two new counts include this tab.

## 4. The agent surface

### 4.1 Every state result carries the link

Every state-reporting result adds two fields when, and only when, the
client holds an unexpired invitation:

    {
      ...state,
      continueUrl,        // design parameters + via=chatgpt + join=<standing token>
      continueExpiresAt   // epoch ms
    }

`continueUrl` is built the way `liveHandoffUrl` is built today, from the
design as it is at result time, so a concurrent edit is included. It is
omitted, never faked, when no invitation is held. `designUrl` stays as
the permanent link in every snapshot.

Building the URL is string formatting over data already in memory. The
purity rule of the current specs, that a read never mints, is preserved
in its intent and tightened in wording: **a read never causes a mint.**
The mint happened in the Session DO when the socket opened.

### 4.2 The agent's instruction, shortened

The paragraph of link guidance in `describe_project` becomes:

> `continueUrl` is the link to give the potter whenever they want to see,
> open, or continue the design in their browser; return it verbatim.
> `designUrl` is a permanent independent copy; give it only when they
> ask for a permanent or bookmarkable link. If `continueUrl` is missing,
> call `create_live_handoff`.

Every other tool's description drops its link rule sentence. The manifest
invariant that repeats it is rewritten to the same three sentences.

### 4.3 The tool inventory

| Tool | Change |
| --- | --- |
| describe_project | shorter description; `continueUrl` and the actor counts in the result |
| open_model, update_design, apply_preset, undo_last_change | unchanged behavior; `continueUrl` in the result; shorter descriptions |
| get_template_summary, get_preview_image, export_templates | unchanged |
| create_live_handoff | explicit fresh mint: asks the Session DO to rotate the standing invitation now and mints a code beside it; returns `{ continueUrl, code, designUrl, expiresAt, expiresInSeconds, singleUse: true, instruction }`; fail-closed shape unchanged |
| join_session | unchanged |
| start_pairing | removed; its job is the code in `create_live_handoff` |
| get_perf_report | unchanged, still conditional |

Ten always-registered tools. The README table, the WebMCP page list,
`TOOL_SUMMARIES`, the e2e expected list, the manifest, and the diagrams
change in the same pull request, as the docs guard and the tool test
require.

### 4.4 Why rotate on an explicit call

`create_live_handoff` requesting a rotation, rather than returning the
standing token, keeps today's acceptance rule that two consecutive
handoff calls use distinct credentials, and gives an agent a way to
invalidate a link it may have pasted somewhere it should not have. The
previous token stays valid until it expires or is claimed; rotation only
changes which one is advertised. Whether the previous token should be
revoked on rotation is a small open question; revoking is safer, and the
Pairing DO already has the delete path the sweep uses.

### 4.5 Pairing at registration

When the WebMCP host registers the tool set, the app calls `pair()` in
the background. This creates a session id if none is stored and opens
the socket, so the welcome, and with it the first standing invitation,
usually arrives before the first tool call. The solo grace period is
unchanged: an agent tab whose invitation nobody opens forgets its session
after 16 minutes, as a person's unused Continue invitation does today.

The first tool call does not wait for the socket. If the welcome has not
arrived, the result simply lacks `continueUrl` and the instruction sends
the agent to `create_live_handoff`, which waits as it does today.

## 5. The person's browser and the agent's browser

The common case in the original idea is that the WebMCP layer lives
inside the agent's own browser and the person's browser only follows.
This document changes nothing about that arrangement; it makes it the
default outcome of every conversation:

1. ChatGPT opens the site in its built-in browser. The host registers
   the tools; the app pairs in the background.
2. The first state result carries `continueUrl`. The agent replies with
   it whenever the person wants to see the design.
3. The person opens it in their browser. The boot path claims the token
   and joins. Their browser needs no WebMCP.
4. The Session DO rotates the invitation. The agent's next result carries
   a different `continueUrl`, ready for a third screen or a fresh tab.
5. If the person's browser also exposes WebMCP, the tools register there
   too. Two agent-capable tabs in one session are already supported and
   need nothing new.

The reverse direction, person first and agent second, is the prompt in
the UI document: the link first, the code as the fallback.

## 6. Performance case

This section states what would be measured, not results. Numbers belong
in docs/performance-report.md with a commit and a date.

| Measure | Baseline source | Expected direction |
| --- | --- | --- |
| Unarmed discovery metadata bytes | the metadata budget in src/mcp/promptSuite.test.ts | down; three link-rule sentences and one tool leave the metadata |
| Tool calls in a "design, edit, hand off" conversation | a new multi-call case in e2e/perf.cases.json, which today measures single tools only | 3 to 2 |
| Time from first tool call to a returned live link, cold Durable Object | the profiler's per-call timings in an agent host | down; the socket opens during registration rather than inside the first mint |
| Frames per session per 15 minutes | Worker logs | up by one `invitation` frame per rotation; negligible |
| Pairing DO mints per session | Worker logs | up: one at socket open and one per claim or expiry, versus zero for sessions that never invited; bounded by the socket lifetime and the 15-minute lifetime |
| Sessions created per visitor | Worker logs | unchanged for human tabs under the "pair on sheet open" policy; up by one per agent conversation |

The last row is the cost of the change: every agent conversation that
registers tools now creates a session and a Durable Object, whether or
not a link is ever used. Today that happens only when the agent mints.
The solo grace period bounds the storage; the Durable Object wake is the
real cost and should be measured before step 4 of the plan is considered.

## 7. Security review points

For whoever reviews this if it is ever approved:

- **Exposure.** A standing token appears in every state result, so it
  appears in more agent transcripts than today's on-demand token. It is
  still single-use and 15 minutes long. Rotation on claim means a token
  that was used is worthless in a transcript; a token that was never used
  is a bearer capability for up to 15 minutes, as today.
- **Codes on demand only.** The brute-force window for codes is
  unchanged from today because codes still exist only while someone is
  showing or holding one.
- **Two Durable Objects talking.** The Pairing DO would call the Session
  DO on claim. Both are reached only over stubs; no new public route.
- **Uniform misses.** Unchanged. The Session DO's knowledge of its own
  invitation does not leak to any client other than its own sockets.
- **Origin checks and rate limits.** Unchanged.
- **Actor counts.** A malicious client can lie about its actor, as it can
  today. The counts feed a label, never a permission.

## 8. Tests that would be added or changed

- Worker: a session mints a standing invitation on first hello; a claim
  rotates it and broadcasts; the early-expiry alarm rotates it; no
  rotation without sockets; presence carries actor counts.
- Client: `invitation()` follows welcome and rotation frames; returns
  null before welcome and after expiry; remembered in minted secrets.
- Tools: every state-reporting result carries `continueUrl` when an
  invitation is held and omits it otherwise; the URL has `via=chatgpt`
  and one `join`; `create_live_handoff` returns a different token than
  the standing one and a code; `start_pairing` is absent; the tool count
  is 10 unarmed and 11 armed.
- Docs guard: the retired-phrases list is reviewed; `continueUrl`
  replaces `liveHandoffUrl` in the required-terms check; the README
  table matches the new summaries.
- End-to-end: the cross-context pairing suite drives the Continue sheet;
  a new multi-call perf case records the handoff conversation at two
  calls.

## 9. Open questions, restated

1. Revoke the previous token on explicit rotation, or let it expire?
2. Should an agent tab's session survive longer than the 16-minute solo
   grace when the conversation is still open but no link was used?
3. Is `continueUrl` the right name, or should the field keep
   `liveHandoffUrl` to avoid churn in prompts people have already saved?
4. Does the Pairing DO notify the Session DO, or does the Session DO
   learn of the claim from the joining socket's first hello? The second
   needs no new DO-to-DO call but leaves a window where two tabs hold a
   spent link.
