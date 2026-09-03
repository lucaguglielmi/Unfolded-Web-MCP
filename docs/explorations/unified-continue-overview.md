# One Continue: overview and plan

> **Status: exploration only — NOT approved, NOT scheduled, do not
> implement.** This document explores an idea. It is not a source of
> requirements. The repository owner has not decided whether to build it.
> If that decision is ever made, the content here is rewritten into the
> current specifications; nothing is built from this file directly.

Baseline: main at 7f336a4, read on 2026-09-03

Would amend if built: docs/live-sync-spec.md, docs/live-handoff-link-spec.md,
docs/webmcp-tool-performance-spec.md, docs/user-flow.md, the three
diagrams under docs/diagrams/, README.md, and the WebMCP explainer page.

Companion documents: [what the person sees](unified-continue-ui.md) and
[under the hood and the agent surface](unified-continue-protocol-and-tools.md).

## 1. The idea in one paragraph

Today the potter meets five concepts before their design is on a second
screen or in an agent: WebMCP, pairing, a live handoff link, a Continue
invitation, and a six-character code. Under the hood there is one
mechanism, a session with single-use invitations, and every surface
re-explains it. The exploration collapses the vocabulary to one internal
primitive, **pair**, and one visible verb, **continue**. A tab can
continue *in your agent* or *on another device*; everything else happens
silently. From the agent's side, every state result already carries a
fresh continuation link, so an agent opens a paired session by default
without being told to call a link tool first, and the WebMCP layer stays
inside the agent's own browser in the common case.

## 2. What exists now, read from the source

This is the reference the exploration argues against. It is accurate at
the baseline commit.

### 2.1 Credentials

| Credential | Minted by | Contains | Shown as |
| --- | --- | --- | --- |
| Live handoff link | `create_live_handoff`, `start_pairing` | design parameters, `via=chatgpt`, single-use `join` token | `liveHandoffUrl` in a tool result |
| Continue invitation | the PairDialog | design parameters, single-use `join` token | QR and Copy link in the dialog |
| Six-character code | `start_pairing`, the PairDialog, the ConnectionHub prompt | code only | large monospace text, the ChatGPT prompt |

All three resolve to a session id server-side through one claim endpoint.
Codes and tokens share a table, a 15-minute lifetime, single use, and rate
limits. Neither ever names the session.

### 2.2 Surfaces

- **ConnectionHub**: the two-dot header button. One dot is the agent
  status (native, chatgpt, unavailable), the other is the sync state
  (none, alone, reconnecting, live). Its panel explains both, offers
  *Open in ChatGPT* and *Copy prompt*, links to the explainer, and opens
  the PairDialog. The ChatGPT prompt tells the agent to open the site and
  call `join_session` with a pre-minted code.
- **PairDialog**, titled *Continue on desktop* or *Continue on your
  phone*: QR, Copy link, the code, an *Enter a code from another screen*
  toggle, *Unpair this device*, and a browser-aware paragraph about
  WebMCP and live links.
- **ClipboardJoinBanner**: recognizes a copied code or live link and
  offers a one-tap join. Never joins silently.
- **MobileMenu**: *Continue on desktop*, which opens the PairDialog.
- **Agent tools**: `create_live_handoff`, `join_session`,
  `start_pairing`, plus long guidance inside `describe_project` about
  which link to offer and in which order.

### 2.3 Rules the current specs hold as invariants

- State reads never mint a token. Snapshots are pure.
- A failed link mint returns no URL at all. A permanent link is never a
  fallback for a live one.
- Session ids never appear in URLs. The address bar and the printed PDF
  QR are parameter-only.
- The app never claims *paired* for a session no second device joined.
- Nothing joins silently except the URL boot path, which the person
  chose by opening a link.

The exploration keeps every one of these except the first, and it
replaces the first with a stricter form: state reads never *cause* a
mint, but they may *report* an invitation that the server already holds.

## 3. The two halves of the change

### 3.1 The person's side

One header control with one word on it, *Continue*, and one status. One
sheet with two primary actions:

- **Continue in ChatGPT** (and *Copy for another assistant*).
- **Continue on another device** (QR and Copy link; the typed code is a
  secondary line under the QR, not a section of its own).

No copy in the default path says WebMCP, pair, pairing, session, sync,
token, handoff, or a tool name. The code entry and disconnect actions
exist but sit behind one secondary line each. The full copy rules,
states, and failure cases are in the UI document.

### 3.2 The agent's side

Every state-reporting result carries `continueUrl` and
`continueExpiresAt`, the current standing invitation of this tab's
session. The agent returns `continueUrl` verbatim whenever it gives the
potter a link. `create_live_handoff` remains only as the explicit "give
me a brand-new one" tool, and it also returns the code; `start_pairing`
folds into it. `join_session` stays for the reverse direction. The tool
inventory goes from 11 to 10, and the pairing prose inside
`describe_project` shrinks to two sentences.

The invitation is not minted on the read path. The Session Durable
Object holds one standing invitation per session, sends it in the
welcome, and rotates it when it is claimed or about to expire. A client
therefore always knows the current invitation with no extra round trip,
and a tool result copies it from memory. The protocol details and the
performance argument are in the under-the-hood document.

### 3.3 What "always paired" would mean in practice

The phrase in the original idea is "pairs everything all the time without
the user knowing". The exploration reads that as: a session exists before
anyone needs it, on every path where a continuation is plausible, and the
person never has to ask for one.

- An agent tab pairs the moment the WebMCP host registers the tools, in
  the background, so the first tool result already carries a link.
- A tab opened from an invitation is paired by the boot path, as today.
- A human tab pairs when the Continue sheet opens, as today, but the
  sheet no longer says so.
- A plain visitor who never continues never gets a session. This keeps
  the Worker cost proportional to intent rather than to traffic.

Whether the last point should move to "pair on first edit" is an open
decision, listed in §6.

## 4. Why this is worth exploring

- **Fewer words before the first success.** The PairDialog's default
  view is roughly 120 words of explanation around a QR. The screenshot
  that prompted this exploration shows it filling a phone screen. The
  Continue sheet's default view is two buttons and one status line.
- **One conversation turn saved per handoff.** Today the reliable agent
  loop is describe, update, create_live_handoff, reply. With the standing
  invitation it is describe, update, reply, and the link is already in the
  update result.
- **Discovery metadata gets lighter.** The pairing guidance is repeated
  in three tool descriptions and the manifest. Moving the default link
  into the result removes most of that prose from the metadata the host
  pays for on every conversation.
- **The cold-start wait leaves the tool path.** The first mint in an
  agent tab can spend up to two 8-second attempts on a cold Durable
  Object. Pairing at registration moves that wait to the background,
  before the first tool call.
- **One primitive, one place to test.** A single `Invitation` value with
  both a token and an optional code replaces three near-identical minting
  paths in the client and two in the tools.

## 5. Why it might be wrong

These are the reasons to say no, stated as strongly as the reasons to
say yes.

- **A standing token is a standing bearer capability.** Today a token
  exists only while someone is actively inviting. A standing one exists
  for the life of every connected session and lands in every tool result
  and, through the agent, in chat transcripts. It is still single-use and
  15 minutes long, but its exposure surface grows. The under-the-hood
  document limits this by keeping the six-character code on demand only
  and by rotating tokens on claim; it does not remove the change in kind.
- **Silence hides state people sometimes need.** The two dots are
  honest: they say whether an agent is here and whether a second device
  is here. A single status line can say the same, but the moment the
  answer is "reconnecting" or "that link was already used", the sheet has
  to explain a mechanism it otherwise hides.
- **Naming the agent is a product decision.** "Continue in ChatGPT" is
  the obvious label today. It hard-codes one host in the primary action.
  The alternative, "Continue in your agent", is vaguer for most people.
- **An agent may fetch instead of open.** If the prompt for the agent
  carries a link, some agents will fetch the URL with a text tool rather
  than open it in their browser, burning the token without pairing. The
  UI document keeps the code in the prompt for that reason, which is
  exactly the mechanism the person was supposed to stop seeing.
- **The retired-claims guard exists for a reason.** The docs guard
  retired phrases like "every link the agent hands you is a live one"
  because they were once true, then false, and the copy drifted. This
  exploration would make a version of that sentence true again. If built,
  the guard's list has to be revisited deliberately, not deleted.
- **It touches everything at once.** Two dialogs, one banner, the mobile
  menu, three tools, the manifest, the README table, the e2e expected
  tool list, three diagrams, four specs, and the Worker protocol. The
  plan in §7 splits it into steps that ship alone, but the total is a
  large change to a surface that currently works.

## 6. Decisions the owner would have to make first

None of these are decided. Each has a recommendation for the sake of
argument, not as a commitment.

| Decision | Options | Recommendation in this exploration |
| --- | --- | --- |
| Field name for the standing link | keep `liveHandoffUrl`; rename to `continueUrl` | rename; the old name describes an act, the new one describes what the potter does with it, and the docs guard already checks for the field names in agent copy so a rename is caught everywhere |
| Standing code | mint the code alongside the standing token; token only, code on demand | token only; a 30-bit code that is always live for every session widens the brute-force window for no gain, since the code is only ever needed when a human is looking at the sheet |
| When a human tab pairs | on sheet open (current); on first edit; at boot | on sheet open for the first step, then measure whether the first-edit variant is worth a Durable Object per editing visitor |
| Primary label | Continue in ChatGPT; Continue in your agent | Continue in ChatGPT with a small *another assistant* action; measure |
| Tool count | keep 11 with new semantics; fold `start_pairing` into `create_live_handoff` | fold; two mint tools with overlapping results is the kind of duplication the tool-performance spec removed elsewhere |
| Token lifetime for a standing invitation | 15 minutes with rotation; shorter | 15 minutes; the number is already documented, printed, and tested, and rotation on claim is the real protection |

## 7. A plan, if it were ever approved

Each step is independently shippable and leaves the site working. Steps 1
and 2 are invisible to the person. The order is chosen so that the
riskiest protocol change ships first with no UI dependency and can be
reverted alone.

1. **Standing invitation and presence by actor (Worker and client).**
   Session Durable Object holds one invitation per session; welcome and
   a new `invitation` frame carry it; presence frames carry human and
   agent counts. The client exposes it through the sync client. No UI or
   tool changes. Tests in the Worker and client suites. Reverting this
   step is removing two frame fields.
2. **Agent surface.** `continueUrl` and `continueExpiresAt` in every
   state result; `create_live_handoff` returns link plus code;
   `start_pairing` removed; descriptions shortened; manifest, README
   table, e2e expected tools, docs guard, and the tool-performance spec
   updated in the same pull request, as the same-pull-request rule
   requires for anything that touches the tool table.
3. **The Continue sheet.** Replaces ConnectionHub's panel and PairDialog
   with one component; MobileMenu and ClipboardJoinBanner reworded; copy
   audit against the banned-word list; end-to-end pairing suite updated
   for the new selectors. The ChatGPT prompt carries link and code.
4. **Pairing policy for human tabs.** Only if measurements from steps 1
   to 3 argue for it: pair on first edit, with the solo grace period
   unchanged so an unused session still forgets itself.
5. **Docs and diagrams.** Rewrite the four current specifications and
   re-render the three diagrams with d2 0.8.2. Delete this exploration.

Rough sizing, for discussion only: step 1 is the largest engineering
change and the smallest diff; step 3 is the largest diff; step 2 is the
one most likely to break a guard, which is the point of the guards.

## 8. What would prove it worked

If approved, the exploration succeeds when all of the following hold on
the deployed site:

1. A person can put the design on a second device, or into ChatGPT, from
   one control, without reading the words WebMCP, pair, session, sync,
   token, or handoff.
2. An agent that never calls a link tool still returns a working live
   link after any edit, and a second call after the link is used returns
   a different working link.
3. A "design, edit, hand off" conversation uses one fewer tool call than
   at the baseline. e2e/perf.cases.json measures single tools today, so a
   multi-call case would be added to record this.
4. The unarmed discovery metadata is smaller than at the baseline by a
   margin the tool-performance test constant records.
5. Every invariant in §2.3 except the first still holds, and the first
   holds in its stricter form.
6. The end-to-end pairing suite passes across two browser contexts with
   the new selectors and no reliance on removed dialogs.

## 9. What this exploration does not propose

- Multi-use invitations, longer lifetimes, or session ids in URLs.
- Automatic joining from the clipboard. The banner keeps its one tap.
- Any change to the printed QR, which stays parameter-only.
- Any change to the design model, sync patches, undo, or export.
- Removing the WebMCP explainer page. Technical vocabulary belongs there.
