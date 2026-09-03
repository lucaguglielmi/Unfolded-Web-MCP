# One Continue: what the person sees

> **Status: exploration only — NOT approved, NOT scheduled, do not
> implement.** This document explores an idea. It is not a source of
> requirements. The repository owner has not decided whether to build it.
> If that decision is ever made, the content here is rewritten into the
> current specifications; nothing is built from this file directly.

Baseline: main at 7f336a4, read on 2026-09-03

Would amend if built: docs/user-flow.md §§2, 3, 5, 7, 8; docs/live-sync-spec.md
§9; docs/live-handoff-link-spec.md §7.3; the copy in
src/components/ConnectionHub.tsx, src/components/PairDialog.tsx,
src/components/ClipboardJoinBanner.tsx, src/components/MobileMenu.tsx;
the e2e pairing selectors.

Overview and plan: [unified-continue-overview.md](unified-continue-overview.md).
Under the hood: [unified-continue-protocol-and-tools.md](unified-continue-protocol-and-tools.md).

## 1. Principle

One verb, **Continue**, in one place. The person chooses *where* to
continue; the app decides *how*. Mechanism words never appear on the
default path. They appear only when the mechanism has failed and the
person has to act on it, and then only the one word the failure needs.

## 2. Vocabulary

### 2.1 Words the default path may use

continue, this device, another device, your phone, desktop, ChatGPT,
another assistant, link, QR, code, connected, reconnecting, disconnect,
copy, open, scan, expires, works once.

### 2.2 Words the default path never uses

WebMCP, pair, paired, pairing, unpair, session, live session, sync,
synced, live sync, token, handoff, invitation, join, peer, agent status,
any tool name, any URL parameter name.

*Live* on its own is allowed as an adjective ("edits appear live") and
banned as a noun ("the live").

### 2.3 Where the banned words still belong

The WebMCP explainer page, the agent manifest, the README, and the
specifications. The person who reads those wants the mechanism. A
*How does it work* link on the sheet leads there.

## 3. The header control

Replaces the two-dot ConnectionHub button and the PairDialog's own
trigger. One rounded button, one small dot, one word or one short status.

| State | Dot | Label on wide screens | Label on phones | Derived from |
| --- | --- | --- | --- | --- |
| Only this device | outline | Continue | Continue | no session, or a session no second party ever joined |
| Agent here, no other device | green | ChatGPT | dot only | presence reports at least one agent socket besides this tab, or this tab itself is the agent's tab |
| Other devices, no agent | green | 2 devices | dot only | presence reports human sockets above one |
| Agent and other devices | green | ChatGPT + 1 | dot only | both of the above |
| Reconnecting | amber | Reconnecting… | dot only | a stored session whose socket is down |

Presence by actor comes from the protocol addition in the under-the-hood
document. Until that ships, the control can only say *2 devices*, and the
agent chip is limited to the tab's own agent status, which is what the
two dots show today.

The honesty rule stays: a session no second party ever joined shows as
*Only this device*, whatever the socket is doing. The label never says
ChatGPT because a link carried `via=chatgpt`; that marker means the tab
was opened from an agent link, not that an agent is present.

The `aria-label` carries the full sentence: "Continue — this design is
open on this device and in ChatGPT".

## 4. The Continue sheet

Opens from the header control and from the mobile menu. On phones it is a
bottom sheet; on desktop a small dialog. Its default view fits above the
fold of a phone with room to spare.

### 4.1 Layout, top to bottom

1. **Title.** *Continue*.
2. **Status line.** One sentence. *This design is open on this device.* /
   *…on this device and in ChatGPT.* / *…on this device and your phone.* /
   *…on 3 devices.* When reconnecting: *Reconnecting to your other
   screens — edits made meanwhile are kept.*
3. **Continue in ChatGPT.** A primary button that is a real anchor to the
   ChatGPT universal link, as today, so phones hand off into the app.
   Under it, one small text action: *Copy for another assistant*.
4. **Continue on another device.** A primary button. Tapping it expands
   the QR and a *Copy link* button in place. Under the QR, one line:
   *or type* **`K7F-3QP`** *on the other device*, where the code is tap-to-copy.
   One line of help: *Scan or open on the other device. Works once,
   expires in 14:59.*
5. **Have a code from another device?** A secondary text action that
   reveals the code field and a *Continue here* button.
6. **Disconnect this device.** A tertiary text action, shown only when
   this tab holds a session. Confirms in place: *Disconnected — the design
   stays here and stops following other screens.*
7. **How does it work** — a small link to the explainer page.

Items 3 and 4 are the whole default view. Items 5 to 7 are one line each.

### 4.2 What each action does under the hood

| Action | Today | In this exploration |
| --- | --- | --- |
| Continue in ChatGPT | pre-mint a code while the panel is open; the prompt tells the agent to open the site and call `join_session` with the code | the same anchor, but the prompt carries the standing continuation link first and the code second (see §6) |
| Copy for another assistant | copy the same prompt | the same |
| Continue on another device | the PairDialog mints a token for the QR and a code beside it, both eagerly on open | the QR and Copy link use the session's standing invitation, already known to the client; the code is minted on demand when this section expands |
| type the code / Continue here | `joinWithCode` | the same call |
| Disconnect this device | `unpair` | the same call |

The sheet never mints anything until a section that needs it is expanded.
Opening the sheet still creates a session if the tab has none, as opening
the PairDialog does today, because the QR and the ChatGPT link both need
one.

### 4.3 After the other side connects

The single-use QR, link, or code is spent the moment it is claimed. The
expanded section collapses into the status line, which now names the new
party, and a one-line confirmation appears for a few seconds: *Your phone
is here — edits appear on both.* The *Continue on another device* button
stays available for a third screen and expands a fresh invitation.

### 4.4 Expiry while the sheet is open

The countdown reaches zero, the QR and code fade, and the section
re-expands with a fresh invitation without any tap. This matches the
current dialog's re-mint behavior, minus the text explaining it.

## 5. Tabs opened from an agent link

A tab opened from a link that carried `via=chatgpt` behaves as today: the
parameter snapshot hydrates, the token is stripped, and the claim runs.
The sheet's status line then reads one of:

- *This design is open on this device and in ChatGPT.* The claim
  succeeded and the agent's socket is present.
- *This link was already used or has expired. Ask ChatGPT for a fresh
  link.* The claim failed. One button: *Copy a request for a fresh
  link*, which copies "Send me the latest link to continue my Unfolded
  design." This is the one place the person is told a link can be spent,
  because they have to act on it.

The header control in the failed case shows *Only this device*, which is
the truth.

## 6. The prompt for the agent

The prompt behind *Continue in ChatGPT* and *Copy for another assistant*
becomes:

> Open this link in your built-in browser: `<continueUrl>`. It is a
> parametric pottery template designer; once it loads you have its tools.
> If the page opened but did not connect to my design, call its
> `join_session` tool with code `K7F-3QP`. Both work once and expire in
> 15 minutes. Then describe the design and help me refine it.

The link goes first because opening it pairs the agent's tab in one step
with no tool call. The code stays because some agents fetch a URL as
text instead of opening it, which burns the token without pairing; the
code is a separate credential and still works. The person never sees the
prompt unless they copy it, and the copy action is labelled for another
assistant, not for reading.

## 7. The clipboard offer

The banner keeps its behavior exactly: recognize a copied code or link,
offer once, never join without a tap, never offer a credential this tab
minted. Only the words change:

- title: *Continue the design from that link here?* or *…from that code
  here?*
- body: *This device will follow that design. Your current design stays
  one undo step away.*
- button: *Continue here*
- failure: *That one was already used or has expired. Ask for a fresh
  one.*

## 8. Mobile menu

*Continue on desktop* stays as the label, because on a phone that is the
most likely intent, and it opens the Continue sheet with the
*Continue on another device* section already expanded.

## 9. Failure copy

| Situation | Copy |
| --- | --- |
| The service cannot be reached when a section expands | *Can't reach the service right now. The design keeps working here; try again in a moment.* with a *Try again* button |
| A typed code fails | *That code was already used or has expired. Ask the other device for a fresh one.* |
| Too many attempts | *Too many attempts right now — wait a minute and try again.* |
| Offline | the status line reads *Offline — edits are kept and sent when you're back.* and the two primary buttons stay enabled, because the ChatGPT link and the QR were minted while online and remain valid until they expire |

## 10. Accessibility and layout

- The sheet is one dialog with a single heading; expanded sections are
  `region`s named by their button.
- The code is announced in three-glyph groups.
- The QR has alt text: *Scan to continue this design on another device*.
- Countdown text updates at most once per second and is `aria-live="off"`;
  the expiry re-mint announces once.
- The default view has two primary buttons of equal weight. On a
  360-pixel-wide phone the default view is under 320 pixels tall.

## 11. Test selectors that would replace the current ones

The end-to-end pairing suite drives the PairDialog through
`data-continue-url` and `data-pairing-code`, and the ConnectionHub through
`data-connection-hub` and `data-chatgpt-prompt`. The sheet would keep the
same four attributes on the equivalent elements so the suite changes only
where the flow changes, not where the names do.

## 12. What stays exactly as it is

- The printed PDF QR is the permanent parameter-only design link.
- The address bar is parameter-only, with the `via=chatgpt` passenger.
- Opening an invitation link joins without a prompt; nothing else does.
- The device that opens the link or enters the code adopts the other
  design, one undo step away.
- The explainer page keeps its technical vocabulary.
