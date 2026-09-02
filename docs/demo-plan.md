# Demo plan — structure (draft 2)

Target: ~3:00 video for the WebMCP Challenge Devpost submission, recorded
against the live site (tryunfolded.com). All footage is screen capture —
no printing, no physical clay shots.

## Narrative choice

Open on Luca's real-problem framing, then make the **Safari ↔ hidden-browser
pairing the stage for the whole demo**, not one beat among many: the user
starts in Safari (no WebMCP), pairs with the agent once, and from then on
*every* agent action — recreating a mug from a photo, the 350 ml resize —
visibly lands in the Safari tab in about a second. The sync isn't
demonstrated once; it's demonstrated continuously.

The three hero capabilities, in the order they appear:

1. **Pairing both directions** — Safari can't run WebMCP; the agent's
   browser is hidden. A 6-character code bridges them over WebSockets, and
   after that neither side is special.
2. **Photo → slab template** — the agent's eyes plus the app's
   deterministic geometry (the answer to "AI templates silently fail").
3. **Capacity with proportions kept** — cube-root scaling plus a
   closed-form capacity solve; one sentence for an agent, hours of
   guess-fire-regret for a human.

## Shot list

### 0:00–0:30 — Intro: a real problem for a real niche (Luca on script)
Voiceover over footage of the app (or a still of a slab-built piece):
introduce yourself, the niche, and the core insight — *generating a precise
printable template from a 3D form with pure AI is error-prone, and a
template that's "almost right" fails silently; the potter finds out four
hours of building later, or worse, after the firing.* Then the one-line
thesis: a parametric app with the pottery know-how embedded
deterministically, and WebMCP as the way an agent drives it.

### 0:30–0:50 — The app in twenty seconds (in Safari, deliberately)
Screen: **Safari**, tryunfolded.com. Drag a slider; 3D preview and flat
templates update together. One breath on the hidden math: shrinkage
compensated the right way, walls developed on the slab mid-surface, exact
capacity. Point out on camera that this is Safari — no WebMCP here — which
sets up the next beat.

### 0:50–1:30 — Beat 1: pairing Safari to the agent's hidden browser
The UX-designer pride point — name the problem explicitly, judges won't
know it exists: *ChatGPT's browser is invisible, and Safari can't speak
WebMCP. How do the two talk?*
- In Safari: open **Continue on another screen** (the connection button —
  the two status dots), tap **copy prompt**. The clipboard now holds a
  ready-made agent prompt with the pairing code already inside it — the
  user never reads or types a code.
- Paste it into ChatGPT. The agent opens the app in its hidden browser and
  `join_session` fires from the code in the prompt: paired, one paste.
- Prove it immediately with something small: ask the agent to make it
  hexagonal → the Safari tab changes in about a second. Then the reverse:
  drag a slider **in Safari**, ask the agent *"what did I just change?"* —
  it reads the current state on its next tool call.
- One line on the mechanics worth saying out loud: WebSockets to a
  per-session room, single-use short-lived codes, every edit is an undo
  step on both sides.

> **Build gap to close before recording:** today `PairDialog` copies the
> *bare* code or the invite link, and the kickstart prompt (with the tool
> briefing) lives on `/webmcp` *without* a code. The one-paste flow above
> needs a small **"Copy prompt for your agent"** button in the pairing
> dialog that wraps the freshly minted code in a kickstart-style prompt
> ("Open tryunfolded.com in your built-in browser … then call
> `join_session` with code XXXXXX …"). Small change, big demo moment.

### 1:30–2:05 — Beat 2: from a photo to a template (Safari still visible)
In ChatGPT: upload a photo of a favorite mug/vase. Prompt: *"Recreate this
as a slab template — it's about 10 cm tall."*
- Agent estimates proportions from the photo, calls `update_form` (and/or
  `apply_preset`), checks itself with `get_preview_image`.
- The payoff shot: the shape converging **in the Safari tab**, side by side
  with the photo. This is the "AI eyes, deterministic geometry" argument
  made visible: the agent chooses the parameters, the app guarantees the
  math.

### 2:05–2:35 — Beat 3: capacity, proportions kept
In ChatGPT: *"Make it hold exactly 350 ml, but keep these proportions."*
- The "impossible by hand" beat: volume scales with the cube, so the agent
  computes the scale factor, sets scaled diameters and height via
  `update_form`, and `set_capacity` does the closed-form finish. Show
  `capacityMl` landing on 350 in the tool result — and the Safari preview
  tracking it live.
- One contrast line: by hand this is guess, recompute, rebuild the
  template, fire, and find out you were wrong.

### 2:35–2:55 — Payoff: the template, on screen
Prompt: *"Export the PDF for A4."* → `export_templates`.
Open the exported PDF full-screen (no printing needed):
- zoom the **calibration bar** and say what it's for (print at 100%, check
  with a ruler);
- flip through the tiled pages with registration ticks;
- zoom the **QR inside the largest piece** — months later it re-derives the
  same design for a new clay body.
One narration line covers the physical step we don't film: cut, tape, lay
on the slab.

### 2:55–3:00 — End card
tryunfolded.com · 13 WebMCP tools on `document.modelContext` · live sync
via Durable Objects · open source (MIT) · 190 unit tests + e2e against a
real WebMCP host.

## Suggested narration (draft to edit)

> Hi, I'm Luca. For this hackathon I solved a real problem for a niche I
> know well: slab pottery.
>
> Asking an AI to generate a printable pottery template is error-prone in
> the worst way: a template that's *almost* right fails silently, and the
> potter finds out four hours of building later — or after the firing.
>
> So I built Unfolded: a parametric 3D designer where the pottery know-how
> — shrinkage, mid-surface development, exact capacity — is deterministic
> code, and WebMCP is how an agent drives it. The agent chooses the
> parameters; the geometry is always right.
>
> Here's the part I'm proudest of as a UX designer. I'm designing in
> Safari — which has no WebMCP at all. ChatGPT's browser does, but it's
> hidden. I tap *copy prompt*, paste it into the chat, and that's the
> whole handshake — the pairing code travels inside the prompt, and the
> two browsers are connected over WebSockets, both directions. Watch:
> every change the agent makes lands in my Safari tab in about a second,
> and every slider I drag here is visible to the agent on its next tool
> call.
>
> [photo beat] … [capacity beat] …
>
> And the output is physical: a multi-page PDF at true scale, calibration
> bar on every sheet, and a QR inside the largest piece that re-derives
> the design years later. Print it, cut it, lay it on clay.

## Production notes

- **Layout:** Safari window and ChatGPT side by side for the whole paired
  section — the point *is* seeing both at once. Full-screen the PDF only
  for the payoff.
- **Keep visible:** ChatGPT's tool-call chips (proof it's WebMCP, not
  editing tricks) and the two status dots turning on in Safari when the
  session pairs.
- **Mint the code in Safari, not in the agent** — the joining side adopts
  the other's design, and we want the agent to adopt the Safari design.
  The copy-prompt button belongs in Safari's pairing dialog for the same
  reason.
- **Record beats as separate takes**; `open_model` on a share link
  restores any state between takes.

## Risks / fallbacks

- **WebMCP flakiness in ChatGPT:** backup recording path is desktop Chrome
  with `chrome://flags/#enable-webmcp-testing` standing in for the hidden
  browser — same tools, same chips; the Safari side of the story is
  unchanged.
- **Pairing code expiry (5 min):** mint the code right before the take.
- **Photo beat variance:** pick the photo in rehearsal and keep it. One
  visible self-correction round via `get_preview_image` is fine on camera;
  cut if it takes more than two.
- **Capacity beat:** verify in rehearsal that the agent chooses
  proportional scaling (not height-only `set_capacity`) for the "keep
  proportions" phrasing; tighten the prompt if it doesn't.
