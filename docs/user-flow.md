# User flow: continue a design across screens

Status: current guide

Baseline: current main implementation at 1a2995d

Last verified: 2026-09-03 against the live-sync UI, URL boot path,
WebMCP descriptions, and current source

This guide explains what the potter and the agent see. Protocol details are
in live-sync-spec.md; the agent link rules are in
live-handoff-link-spec.md.

## The short version

An Unfolded design is a set of URL parameters. A permanent design URL
reopens an independent copy. A live handoff link adds a short-lived,
single-use invitation so the opening tab follows the tab that minted it.

Once two tabs are paired, edits flow both ways. The agent sees browser
edits on its next tool call, and the browser sees agent edits as they
arrive. WebMCP is needed only by the agent; a normal browser can follow,
edit, preview, and export a live session.

## Quick reference

| Goal | Action | Result |
| --- | --- | --- |
| Put an agent's design on another screen | Ask for the latest link and open it | The opening screen adopts the agent tab's design and becomes live |
| Give an agent the design on this screen | Open the connection control and choose Open in ChatGPT, or give the agent the six-character code | The agent tab adopts this screen's design |
| Make a permanent copy | Ask for a permanent or bookmarkable link | The returned designUrl has no session access |
| Reopen from paper | Scan the QR in the PDF | A parameter-only design copy opens |
| Join without a link | Enter the six-character code | The entering device adopts the minting device's design |

Pairing happens once. Afterward, the tabs remain peers until a tab
unpairs, the session expires after 30 idle days, or the service is
unavailable.

## 1. Agent to a visible browser

1. Ask the agent to design or edit the piece.
2. Ask for the latest live link. The agent calls create_live_handoff
   immediately before returning it and gives back liveHandoffUrl verbatim.
3. Open that link in the visible browser. The tab claims the invitation,
   removes join from the address bar, and adopts the agent tab's current
   session state.
4. Continue editing in either place. The visible tab receives agent edits;
   the agent reads your browser edits on its next tool call.

The invitation expires after 15 minutes and works once. If it is already
used or expired, ask for a fresh link. Opening an expired invitation still
leaves a usable parameter-only design URL.

On a fresh agent session, describe_project reports session.paired as false
and tells the agent to offer the live handoff first. The six-character code
is the fallback when the link cannot be minted or the design is already
open on another device.

## 2. Browser to agent

The connection control is the two-dot status button in the header. Choose
Open in ChatGPT when available. The app prepares a prompt and a fresh
single-use code; send that prompt to the agent so its browser can call
join_session.

For a manual handoff:

1. Open Continue on another screen.
2. Read or copy the six-character code.
3. Tell the agent to open Unfolded and join with that code.
4. Wait for the agent's next state result to confirm the adopted design.

The device that opens the link or enters the code adopts the minting
device's design. Start the invitation on the screen whose design should
survive.

## 3. Device to device without an agent

The Continue dialog shows a QR, a copyable live link, and a code. Use the
link or scan the QR when the second device can open the same browser
address. Use the code when a person needs to read the invitation aloud or
type it into the other device.

The dialog's live QR/link uses a join token and therefore pairs the opening
device. The QR printed in the exported PDF is different: it is permanent
and parameter-only because paper may be used months later.

After the second device joins, both screens show the live connection and
the invitation display clears. A copied code or live link can also produce
a one-tap join offer in the app. The offer never joins silently.

## 4. Agent workflow

The intended tool sequence is:

1. call describe_project when the request depends on current state;
2. if unpaired, call create_live_handoff and offer its liveHandoffUrl;
3. use one update_design call for a complete multi-field change;
4. call get_preview_image when visual confirmation matters;
5. call get_template_summary when page layout or piece dimensions matter;
6. call export_templates when the potter wants the PDF;
7. call create_live_handoff immediately before returning a live link.

Every state-reporting result includes the full current state and the
permanent designUrl. State reads do not spend a live invitation. A failed
live handoff returns no URL; the agent should retry, use start_pairing, or
ask for the other device's code.

## 5. What the browser shows

- The model preview and controls work without a live session.
- The connection indicator distinguishes unpaired, connecting, and live
  states.
- The Continue dialog exposes the QR, live link, code, and code-entry
  toggle.
- A live peer's edits arrive through the same validated model path as local
  edits and become one undo step.
- Exported pages include a calibration check and a parameter-only design QR.

## 6. Offline and reconnect behavior

The local design persists under the app's project storage key. A paired tab
also remembers its session id under the separate session storage key. If
the socket drops, the tab keeps working locally and retries with jittered
backoff from 1 second to 30 seconds.

Edits made while disconnected are reapplied on top of the next server
snapshot and sent as a local delta. If both sides changed the same field,
server arrival order decides; changes to different fields both survive.

Focus, visibility, and online events trigger a reconnect or a snapshot
probe. A sleeping mobile tab is given wake-up probation so a stale timer
does not delete an active session.

## 7. Link meanings

| Field or link | Meaning |
| --- | --- |
| designUrl | permanent parameter-only copy; safe for a bookmark, address bar, or printed QR |
| liveHandoffUrl | current design plus via=chatgpt and a single-use join token |
| Continue invitation | current design plus a single-use join token; no via=chatgpt marker |
| join | consumed once by the opening tab and removed from the address bar |
| via=chatgpt | provenance marker for a live handoff, not proof that pairing succeeded |

Do not turn a designUrl into a live link by copying the address bar. Ask
the agent to mint a new liveHandoffUrl or use the pairing code.

## 8. If something goes wrong

### The visible browser shows the wrong design

Open the newest live handoff link, or ask the source screen to mint a new
code. The opening device is expected to adopt the source session; mint on
the device whose design should be kept.

### The live link says it cannot be created

No link was generated. Retry once. If it still fails, use start_pairing or
ask the person with the other screen for their code. Do not use the
address-bar URL as a substitute.

### The code does not work

Codes are case-insensitive but must contain six allowed characters. They
expire after 15 minutes and work once. Ask the source screen for a fresh
code and make sure the browser is online.

### Edits stop arriving

Keep both tabs open and bring the affected tab to the foreground. The
client probes or reconnects on wake. If the session has been idle for 30
days, create a new invitation from the current design.

### The agent cannot see the tools

The browser needs a WebMCP-capable host for agent calls. Keep the page
open while the host is connecting; the app watches for a late
document.modelContext registry. A normal browser can still follow and edit
the live session even though it cannot host the agent.
