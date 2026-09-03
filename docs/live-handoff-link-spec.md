# Live handoff link specification

Status: implemented

Baseline: current main implementation at 1a2995d

Last verified: 2026-09-03 against src/mcp/liveHandoff.ts,
src/mcp/tools.ts, the pairing UI, and the live-handoff tests

This document defines the agent-facing distinction between a permanent
design URL and a live continuation URL. It is intentionally short: session
transport details belong in live-sync-spec.md.

## 1. The problem

An agent often edits a design in a hidden browser tab while the potter is
looking at another tab. Returning the address-bar URL opens the right
parameters but does not join the second tab to the agent's session. The
agent must therefore return a link that both opens the design and carries a
one-time invitation.

The two link types have different jobs and must never be substituted for
each other.

## 2. Link types

| Link | Contains | Opens | Capability |
| --- | --- | --- | --- |
| designUrl | design parameters and display units | an independent copy of the design | none |
| liveHandoffUrl | the same parameters, via=chatgpt, and join token | a live peer of the minting tab | one claim, 15 minutes |
| Continue invitation | the same parameters and join token | a live peer of the minting tab | one claim, 15 minutes |

designUrl is used for an explicit permanent, bookmarkable, printable, or
independent-copy request. It appears in state snapshots and is safe to put
in the address bar or the printed PDF QR.

liveHandoffUrl is the agent-facing default continuation link. It is created
on demand by create_live_handoff or returned optionally by start_pairing and
must be returned verbatim. The human Continue dialog creates a separate
Continue invitation with the same join-token capability but without
via=chatgpt, because it is not an agent-provenance link.

Neither URL contains a session id. The live token is a short-lived bearer
capability and is removed from the address bar after the opening tab
attempts to claim it.

## 3. Required selection

Use create_live_handoff when the agent is about to give the potter an
Unfolded link after creating, editing, previewing, or opening a design, or
when the potter asks to see, open, or continue the design in a browser.

Use the permanent designUrl only when the potter explicitly asks for a
bookmarkable, printable, permanent, or independent-copy link.

Never return:

- the current address-bar URL as a live invitation;
- a link from an earlier tool call when a newer one was requested;
- a reconstructed URL with a guessed or copied token;
- a permanent design URL as if it were live.

If the agent needs both a live continuation and a permanent copy, return
the two fields with their meanings labelled.

## 4. create_live_handoff

### 4.1 Input and success result

The tool takes no input. It mints a fresh token for the current session,
then builds both URLs from the design after the mint resolves. The text
content serializes the handoff object with exactly these fields:

    {
      liveHandoffUrl,
      designUrl,
      expiresAt,
      expiresInSeconds,
      singleUse: true,
      instruction
    }

The structuredContent result adds ok true and message beside those same
handoff fields.

liveHandoffUrl contains via=chatgpt and join. designUrl contains neither.
The expiresAt value is epoch milliseconds. expiresInSeconds is the rounded
remaining lifetime at result construction.

The instruction field says to return liveHandoffUrl verbatim, not the
address-bar URL, and to use designUrl only for an explicitly permanent or
independent-copy request.

### 4.2 Minting and retry

The tool waits for the session connection needed to mint. It attempts the
mint twice, including when the first attempt returns no token or an already
expired token. The retry absorbs a cold session Durable Object without
making the potter wait for a second agent turn.

After the mint succeeds, the tool reads the current store and builds both
URLs. A concurrent edit that is visible before that read is therefore
included in the returned design.

## 5. Fail-closed result

If both mint attempts fail, or the tool is cancelled, no URL is returned.
In particular, a failure does not include designUrl, the address-bar URL,
the session id, or an earlier invitation.

The structured failure shape is exactly:

    {
      ok: false,
      message
    }

The failure text may tell the agent to retry, ask the potter for the
potter's own six-character code, or use start_pairing. It must not contain
an HTTP URL or a parameter-only design URL.

Cancellation also returns ok false and a cancellation message. A token
that happened to be minted before cancellation is left to expire; it is
never exposed as a successful result.

## 6. State snapshots

Every state-reporting result carries designUrl as the permanent link. A
state read does not mint a token and does not expose liveHandoffUrl.

The current state shape includes:

    {
      form,
      clay,
      paperSize,
      units,
      designUrl,
      capacityMl,
      pieces,
      printedPages,
      warnings,
      session: { paired, peers }
    }

The exact values are produced by describeState. The snapshot is a fact
about the current tab; session.paired says whether it holds a session and
peers is the last server-reported socket count.

## 7. Pairing tools and UI

### 7.1 start_pairing

start_pairing mints a six-character code and a live handoff token in
parallel for the current session. It returns the full state and includes
liveHandoffUrl in the structured result when the token mint succeeds. A
successful code mint still succeeds if the link mint fails, so the code
route remains available.

The code is six characters, read-aloud friendly, single-use, and valid for
15 minutes. The other device adopts this tab's current design when it
claims either invitation.

### 7.2 join_session

join_session accepts the six-character code from another device, ignoring
case, whitespace, and separators. It waits for the first sync snapshot
before returning the adopted state. An invalid or expired code leaves the
current state unchanged; a retryable service failure says to try again.

Opening a liveHandoffUrl uses the URL boot path rather than
join_session. Both paths claim the same type of server-side single-use
credential and join the same session.

### 7.3 Human Continue dialog

The connection control opens Continue on another screen. The dialog mints
and displays a QR, a copyable Continue invitation, and the six-character
code together. The invitation has a join token but no via=chatgpt marker.
Code entry is behind the join toggle. Once a second peer is confirmed, the
invitation display is cleared.

The app may recognize a pasted or copied code or live link and offer a
one-tap join. It never joins automatically and never offers back a
credential minted by the same tab.

## 8. URL construction rules

The URL path is the studio root. Model parameters are generated by the
same serializer used for permanent design links, including form, fired
dimensions, clay settings, paper size, and display units.

Only live handoff construction or the Continue dialog may add join. Only
agent handoff construction may add via=chatgpt. The address bar and PDF QR
are always parameter-only. A token is never copied into a state snapshot.

When a live link is opened, the tab first hydrates the parameter snapshot,
marks any via=chatgpt provenance, removes join from the visible URL, and
then attempts the claim. A successful claim makes the session snapshot
canonical; a failed claim leaves the parameter snapshot as a usable design
URL with no live capability.

## 9. Reliability

### 9.1 Cold starts and retry

A first mint can race the session socket opening. create_live_handoff
absorbs this with its two-attempt policy and an 8-second sync wait per mint
operation. A genuine outage still ends in the fail-closed shape after the
second attempt.

### 9.2 No hidden fallback

A permanent URL is not a fallback for a failed live mint. The user-visible
choice is an explicit retry, a code supplied by the other device, or
start_pairing. This preserves the meaning of a link: if the agent presents
it as live, opening it must have a chance to pair.

## 10. Documentation and generated surfaces

The same distinction is repeated in the WebMCP tool descriptions, the
agent manifest, the WebMCP explainer page, and the user-flow guide. These
surfaces must use the current field names designUrl and liveHandoffUrl.

The docs guard checks that agent-facing copy mentions the handoff tools,
does not resurrect the retired share-link field, and does not advertise a
live capability in a permanent URL.

## 11. Acceptance and tests

The contract is satisfied when:

1. a successful create_live_handoff result contains one fresh live URL and
   one permanent design URL;
2. a successful live URL includes via=chatgpt and one join token;
3. state reads contain only the permanent link;
4. a failed or cancelled handoff contains no URL at all;
5. start_pairing returns a usable code even when its optional link mint
   fails;
6. the opening device adopts the minting session's design and then syncs
   both ways;
7. two consecutive handoff calls use distinct credentials.

The tests live in src/mcp/liveHandoff.test.ts and
src/mcp/structuredResult.test.ts, with UI and Worker coverage in the
corresponding pairing and end-to-end suites.
