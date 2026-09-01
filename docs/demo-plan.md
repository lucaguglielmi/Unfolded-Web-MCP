# Demo plan — structure (draft)

Target: ~3:00 video for the WebMCP Challenge Devpost submission, recorded
against the live site (tryunfolded.com) in ChatGPT's built-in browser.

## Narrative choice

One continuous story, not a feature tour: a potter recreates a mug they love
from a photo, sizes it precisely with the agent, pulls the design out of
ChatGPT's hidden browser onto their own phone, and ends with paper on clay.
Each of the three hero beats answers a "why is this hard without an agent /
without WebMCP" question:

1. **Photo → slab template** — the agent's eyes plus the app's geometry.
2. **Capacity with proportions kept** — math a human can't do at the wheel
   (cube-root scaling + closed-form capacity), one sentence for an agent.
3. **Pairing out of the hidden browser** — the structural problem every
   WebMCP-in-ChatGPT app has, solved with join links / codes + live sync.

## Shot list

### 0:00–0:15 — Hook: the paper problem
Real footage: a hand-drawn cereal-box template next to a fired mug that came
out too small. One line of narration: slab potters do the sizing math by
hand, and the two classic errors (wrong shrinkage direction, wrong surface)
only show up after the firing.

### 0:15–0:35 — The app in twenty seconds
Screen: drag a slider, 3D preview and flat templates update together.
Name what's under the hood in one breath: shrinkage-compensated, mid-surface
developed, exact capacity. Then the pivot line: "and the whole app speaks
WebMCP — so an agent can drive it."

### 0:35–1:10 — Beat 1: from a photo to a template
In ChatGPT (built-in browser open on tryunfolded.com): upload a photo of a
favorite mug/vase. Prompt: *"Recreate this as a slab template — it's about
10 cm tall."*
- Agent estimates proportions from the photo, calls `update_form` (and/or
  `apply_preset` as a starting point), then `get_preview_image` to check its
  own work against the photo.
- On-screen: the tool-call chips in the chat + the preview converging on the
  photographed shape. Side-by-side photo vs. preview at the end of the beat.

### 1:10–1:40 — Beat 2: capacity, proportions kept
Prompt: *"Make it hold exactly 350 ml, but keep these proportions."*
- This is the "impossible by hand" beat: volume scales with the cube, so the
  agent computes the scale factor, calls `update_form` with scaled diameters
  and height, and lets `set_capacity` do the closed-form finish. Show
  `capacityMl` in the tool result landing on 350.
- One narration line contrasting the human version: guess, recompute, remake
  the template, fire, find out you were wrong.

### 1:40–2:25 — Beat 3: escaping the hidden browser
Name the problem out loud: ChatGPT's browser is hidden — you can't print
from it, and your own browser can't talk back to it. Then show the answer:
- Every link the agent hands back is a **live** one (single-use join token).
  Tap it on the phone → the visible tab silently joins the agent's session.
- Drag a slider on the phone; then ask the agent *"what did I just
  change?"* — it reads the current state on its next tool call. Both
  directions, ~1 s, no link ferried back.
- Flash the fallback for one second: the 6-character pairing code
  (`start_pairing` / `join_session`) for when a link can't travel.

### 2:25–2:50 — Payoff: paper on clay
Prompt: *"Export the PDF for A4."* → `export_templates`. Real footage:
printed sheets, the calibration ruler measured with a real ruler, pieces cut
and laid on a slab. Show the QR printed inside the largest piece and say why:
months later it re-derives the same design for a new clay body.

### 2:50–3:00 — End card
tryunfolded.com · 13 WebMCP tools on `document.modelContext` · live sync via
Durable Objects · open source (MIT) · 190 unit tests + e2e against a real
WebMCP host.

## Production notes

- **Layout:** ChatGPT screen recording as the main frame; phone footage
  picture-in-picture for beat 3; real-world footage full-frame for hook and
  payoff.
- **Keep visible:** the tool-call chips in ChatGPT (proof it's WebMCP, not
  editing sleight-of-hand) and the header's two status dots when pairing.
- **Rehearse the prompts verbatim** and record each beat as a separate take;
  the story order is fixed but takes don't have to be one session — an
  `open_model` on a share link restores any state between takes.

## Risks / fallbacks

- **WebMCP flakiness in ChatGPT:** back-up recording path is desktop Chrome
  with `chrome://flags/#enable-webmcp-testing` — same tools, same chips.
- **Join token expiry (10 min):** mint the link immediately before the
  beat-3 take.
- **Photo beat variance:** pick the photo in rehearsal and keep it; if the
  agent's first estimate is off, that's fine on camera *once* — it
  self-corrects via `get_preview_image` — but cut if it takes more than two
  rounds.
- **Capacity beat:** verify in rehearsal that the agent chooses proportional
  scaling (not height-only `set_capacity`) for the "keep proportions"
  phrasing; if it doesn't, tighten the prompt.
