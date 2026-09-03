# User flow — continuing a design across screens

How a design moves between devices, browsers, and agents on
[tryunfolded.com](https://tryunfolded.com). The mechanics live in
`docs/live-sync-spec.md`; this document walks the same system from the
user's side, one scenario at a time.

## The moving parts, in one minute

- **A design is a URL.** Every parameter fits in the address bar
  (`?type=tapered&height=600…`). Any plain share link — or the QR printed
  inside the largest template piece — opens a *copy* of the design.
  Parameter links never carry session access.
- **A live session is a room, not a link.** Paired tabs talk over
  WebSockets to a per-session Durable Object; every edit reaches every
  peer in about a second, both directions, and lands as a normal undo
  step. No device is special once it has joined.
- **Two ways into the room:**
  - **Join token** — minted on demand by the agent's `create_live_handoff`
    tool (its default link after any edit) or by the Continue dialog: the
    `liveHandoffUrl` carries `?join=<token>`, single-use, expires in
    15 minutes, dead after its first open. The tab that opens it silently
    joins the agent's session and strips the parameter from the address
    bar. The permanent `designUrl` in every tool result never carries one.
  - **Pairing code** — 6 characters, read-aloud friendly (no I/L/O/0/1),
    single-use, expires in 15 minutes. Humans mint one from the **Continue
    on another screen** dialog (behind the header's connection button — the
    two status dots); agents mint one
    with `start_pairing` or enter one with `join_session`.
- **Who adopts whose design?** The device that *opens the link* or
  *enters the code* adopts the other side's design — as one undo step, so
  it's reversible. Mint on the device whose design you want to keep.
- **Agents read on demand.** An agent doesn't get pushed your edits; it
  sees the current state at its *next tool call* (every tool result
  returns the full state). Edit in any paired browser, then just keep
  talking to the agent — no link needs to travel back.
- **WebMCP is only needed by agents.** Following a design live works in
  any browser — Safari included. WebMCP (Chrome flag
  `chrome://flags/#enable-webmcp-testing`, or ChatGPT's hidden browser)
  is what lets an *agent* call the tools.

## Quick reference

| Scenario | Bridge | Who adopts whom |
| --- | --- | --- |
| ChatGPT → its in-app browser | tap the agent's latest link (`?join=`) | visible tab adopts the agent's design |
| ChatGPT → Chrome (WebMCP flag) | open the agent's latest link | Chrome tab adopts the agent's design |
| ChatGPT → Safari | open the agent's latest link | Safari adopts the agent's design |
| Chrome → ChatGPT | tap **Open in ChatGPT** (prompt + code injected), or mint a code and tell the agent to join | agent's tab adopts Chrome's design |
| Safari → ChatGPT | tap **Open in ChatGPT**, or mint a code and tell the agent to join | agent's tab adopts Safari's design |
| Mobile → desktop (no agent) | copy the invite link, or read the code aloud | desktop adopts the phone's design |

Every bridge is needed exactly **once**. After it, the session is live in
both directions until a device unpairs (or the session self-deletes after
30 idle days).

## 1 · From ChatGPT to its internal browser

*The problem this solves:* ChatGPT runs WebMCP in a **hidden** browser.
The browser you see when you tap a link inside the ChatGPT app is a
*different*, ordinary in-app browser with no WebMCP and no connection to
the hidden one. Without help, the agent would be shaping a design you can
never watch.

*What actually happens:*

1. You ask the agent to design something ("make me a 400 ml tapered
   mug"). Its hidden tab connects over WebMCP and calls the tools.
2. When the agent hands you a link it calls `create_live_handoff` first:
   the tab opens a live session and mints a single-use join token on the
   spot, and the agent returns that `liveHandoffUrl` verbatim — its
   **default link after any edit**. (Its state snapshots carry only a
   permanent `designUrl`; you get that one only if you ask for a
   bookmarkable copy.)
3. Tap the agent's **latest** live link in the chat. ChatGPT opens its visible
   in-app browser; the page claims the token, strips it from the address
   bar, and silently becomes a live peer of the hidden tab. The presence
   badge shows **2 devices**.
4. From here the two tabs mirror each other. Ask the agent for a change —
   you watch it land in the visible tab. Drag a slider in the visible tab
   — the agent sees the new value on its next tool call.

*Details worth knowing:*

- Tokens are single-use. An old link in the scroll-back opens as a plain
  design copy (still correct parameters, just not live). If you missed
  the window, ask the agent for its latest link — every fresh tool result
  carries a fresh token.
- If you never tap any link, no ghost pairing is left behind: a session
  that never saw a second device forgets itself after a few minutes of
  solo grace. The badge never claims "paired" for a session nobody
  joined.

## 2 · From ChatGPT to Chrome with WebMCP enabled

*You've been designing in ChatGPT (say, on your phone) and want the piece
open on desktop Chrome — perhaps so Chrome's own agent can pick it up
too.*

1. Ask the agent for its latest link and open it in Chrome (send it to
   yourself, or type it — any route into Chrome works).
2. Chrome claims the `?join=` token and becomes a live peer: the ChatGPT
   agent's edits appear in Chrome as they happen, and your Chrome edits
   are visible to the agent on its next tool call.
3. The WebMCP flag changes nothing about *following* — it means the
   Chrome tab can **also** host an agent of its own. Two agents (ChatGPT
   in its hidden tab, Chrome's agent in yours) can then drive the same
   session from opposite sides; per-field last-write-wins keeps them
   merged, and `undo_last_change` reverts either one's edits.

## 3 · From ChatGPT to Safari

*Identical to the Chrome flow — and that is the point.* Safari has no
WebMCP and needs none to follow a session.

1. Ask the ChatGPT agent for its latest link; open it in Safari.
2. Safari claims the token, strips it from the URL, and is now a live
   peer. Everything the agent does appears in Safari in about a second.
3. Edits flow the other way too: change the height in Safari, then simply
   ask the agent to continue — its next tool call returns the state
   *including your Safari edits*. You never pass a link back; the link
   was needed exactly once, in one direction.

The only thing Safari can't do is host an agent itself. As a screen —
viewing, editing, exporting the PDF — it is a full citizen.

## 4 · From Chrome to ChatGPT

*You started at the desk, in Chrome, and want to hand the design to a
ChatGPT agent (typically on your phone) without losing what's on screen.*

The fastest bridge is one tap; the spoken code remains for everything
else:

1. In Chrome, tap the header's connection button → **Open in ChatGPT**.
   A new ChatGPT chat opens (the app itself, on phones) with a
   ready-made prompt already injected: it tells the agent to open
   tryunfolded.com in its built-in browser and join your session with a
   fresh single-use code (valid 15 minutes). Just send it. The **Copy
   prompt** button beside it is the same text for pasting into any
   other assistant.
2. Or by code: **Continue on another screen** shows a 6-character code
   right beside the QR; type it into the chat: *"Join my Unfolded session
   with code K7F-3QP."* The agent calls `join_session`.
3. Either way, the agent's hidden tab **adopts your Chrome design** (the
   claimer adopts — your work is what survives) and the two are live.
   Ask for changes in the chat and watch them land in Chrome.
4. Want to *watch* on the phone as well? That's scenario 1 from here:
   tap the agent's next link and the visible in-app browser joins the
   same session as a third device.

Direction matters: if instead the *agent* mints the code
(`start_pairing`) and you type it into Chrome's dialog, **Chrome adopts
the agent's design** — one undo step brings yours back, but mint on the
side whose design you want to keep.

## 5 · From Safari to ChatGPT

*Same bridge as Chrome — the starting browser is irrelevant, because the
Continue dialog is plain WebSockets, no WebMCP involved. **Open in
ChatGPT** works here too (it's an ordinary link); the steps below walk
the spoken-code path.*

1. In Safari, open **Continue on another screen** — the code is shown
   beside the QR.
2. Read it to the ChatGPT agent; it joins with `join_session` and adopts
   your Safari design.
3. From then on: the agent's edits appear live in Safari; your Safari
   edits reach the agent on its next tool call. Keep sculpting in Safari
   and conversing in ChatGPT — nothing else needs to be exchanged.

## 6 · From mobile to desktop (no agent)

*No agent anywhere — you sketched a shape on the phone during a commute
and want it big on the desktop screen.*

Two routes, both from the phone's menu → **Continue on desktop**:

- **Link** — the dialog shows a QR plus a **Copy link** button. The QR is
  aimed the other way (desktop → phone), so from a phone use *Copy link*
  and send it to yourself (email, notes, chat); opening it on the desktop
  joins the session and adopts the phone's design.
- **Code** — read the code shown beside the QR on the phone, then on the
  desktop open **Continue on another screen** → **Enter a code from
  another screen** and type it in. Same result: desktop adopts the phone,
  both live.

Afterwards the pairing is symmetric and durable: close the laptop, edit
on the phone over lunch, reopen the laptop — it reconnects and catches
up, including edits it missed while asleep (offline changes are diffed
and reapplied, per-field last-write-wins). The session lives until every
device unpairs or 30 idle days pass.

The reverse direction (desktop → phone) is the QR's home turf: open the
dialog on desktop, scan with the phone camera, done.

## When something looks off

- **The link opened the design but the badge shows nothing live** — the
  token was already used or older than 15 minutes. Ask the agent for its
  latest link (agent flows), or mint a fresh invite from the dialog
  (human flows). You still got the right parameters either way.
- **The code is rejected** — codes are single-use and expire after
  15 minutes; unknown, expired, and used codes are deliberately
  indistinguishable. Mint a new one.
- **You adopted the wrong side's design** — it landed as one undo step.
  Undo, then redo the pairing minting from the side you want to keep.
- **Printed QR from an old template** — always parameter-only, by design:
  paper never carries session access. It opens the exact design; pair it
  live afterwards with any flow above.
