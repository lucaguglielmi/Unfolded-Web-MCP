# Unfolded

**Slab pottery templates — design in 3D, print flat, build in clay.**

Unfolded lets potters design slab-built forms (mugs, tumblers, vases) as parametric 3D
objects and turns them into true-scale printable templates to cut, tape, and lay on a
clay slab. Every dimension is shrinkage-compensated for your clay body and developed
along the slab mid-surface, so the fired piece matches the design.

The whole app is **WebMCP-native**: it registers its editing tools on
`document.modelContext`, so an agent (e.g. ChatGPT's in-app browser) can inspect and
edit the same design you see on screen — *"make it a 350 ml tumbler and use my
stoneware at 12% shrinkage"* — while the 3D preview and templates update live.

Built for the [WebMCP Challenge](https://webmcp.devpost.com). See [PLAN.md](./PLAN.md)
for the full project plan.

## Why this exists

Slab building is the most common hand-building technique in ceramics, and its
paper step is still manual: potters draw templates on cereal boxes, wrap paper
around forms, and do the sizing math by hand. Two errors are endemic to that
math, and both ruin pieces only after the firing:

- **Shrinkage is scaled the wrong way.** Clay shrinks ~10–13% from wet to fired,
  so a template must be scaled up by `1/(1−s)` — but the intuitive `1+s` is what
  most people reach for, and at 12% shrinkage it leaves every dimension ~1.6%
  short. A lid that no longer fits, a set of mugs that don't match.
- **Walls are measured on the wrong surface.** A slab bends along its middle, so
  a wrapped wall must be developed on the mid-surface (`r − t/2`); using the
  outer dimension makes the wall come out too long and the seam overlap.

Unfolded encodes both corrections and adds the math no one does by hand at all:
exact interior capacity (volume is linear in height, so *"make it hold 350 ml"*
has a closed-form answer) and true miter bevels for tapered faceted forms. The
audience is specific — hand-builders, ceramics teachers, studio classes — and
the output is physical: a PDF that prints at 100% scale, with a calibration
ruler to prove it, that gets cut out and laid on clay.

The agent is not a gimmick on top: sizing questions are exactly what potters
ask in words (*"a mug that holds a full pour-over"*, *"my new clay shrinks
14%, fix my templates"*) and exactly what the geometry can answer precisely.
WebMCP is the bridge between those two facts.

## The non-trivial WebMCP parts

The short list of what makes this more than tools bolted onto a page
(everything below is in [`src/mcp/`](./src/mcp/) and covered by the
committed e2e suite):

- **Thirteen tools with real contracts** — zod-validated inputs exported as JSON
  Schema, honest annotations (`readOnlyHint` / `idempotentHint` /
  `destructiveHint`), and graceful `isError` results that include the unchanged
  state.
- **Every mutation returns the full new state**, so the agent never needs a
  follow-up read — and every state snapshot carries `shareUrl`, which doubles
  as the *return channel*: a page can't push text into a chat, but the agent
  can always hand the potter a link that reopens the exact design.
- **A solver, not just setters** — `set_capacity` computes the exact height for
  a target volume in one call instead of letting the agent iterate.
- **The agent sees what the potter sees** — `get_preview_image` returns the
  live WebGL canvas as image content.
- **Never-give-up registration** — hosts inject `modelContext` at wildly
  different times (ChatGPT only when the person engages the agent), so the app
  watches forever: fast polling, then a heartbeat (paused in hidden tabs), plus
  focus/visibility re-checks, across `document`/`navigator`/`window`, with a
  `provideContext` fallback for hosts without `registerTool`.
- **An honest connection model** — the three-state pill never guesses: direct
  registration, an explicit agent-minted link signal, or nothing. No user-agent
  sniffing, ever.
- **Human and agent are true peers** — same store, same validation, shared
  undo/redo over both actors' edits, and concurrent PDF exports counted, not
  flag-locked.
- **Live cross-device sessions, paired by voice** — a 6-character code spoken
  through the chat pairs phone and desktop into one session (a Durable Object
  per session, WebSocket hibernation, patches in the share-link vocabulary,
  per-field last-write-wins); no URL is ever a live capability.

## Run it

```bash
npm install
npm run dev      # local dev server
npm test         # unrolling-math unit tests
npm run build    # type-check + production build
```

Open the app in a WebMCP-capable browser:

- **ChatGPT's internal browser** — WebMCP works out of the box (note: tapping a link
  in the chat opens ChatGPT's *ordinary* in-app browser instead — a separate session
  without WebMCP)
- **Google Chrome (desktop & Android)** — enable `chrome://flags/#enable-webmcp-testing`;
  when the app detects real Chrome without WebMCP it shows a one-time dismissible tip
  with that address ready to copy

## Agent connection states

The header pill tells the truth about how (and whether) an agent is connected:

| State | Dot | Meaning |
|---|---|---|
| **WebMCP active** | pulsing green | The API is available in *this* tab (`document`/`navigator`/`window.modelContext`) and tool registration succeeded — human and agent share one live session. |
| **Connected via ChatGPT** | solid green | This tab has no direct WebMCP, but the design arrived through an agent-minted link (`?via=chatgpt` on tool-issued `shareUrl`s) — the explicit signal that it's open in the conversation's internal browser. Edits here aren't shared until synced back (`open_model`). |
| **WebMCP** | grey | Neither could be confirmed — the pill just names the capability; the tooltip explains how to connect. |

A ChatGPT connection is shown **only** on that explicit link signal — never inferred
from the user agent, referrer, screen size, or being inside an in-app browser. Direct
registration (or any actual tool call) always upgrades the state to active.

Detection is built for real agent hosts: it watches for the API forever (fast polling
at first, then a slow heartbeat, plus focus/visibility re-checks) because hosts like
ChatGPT inject `modelContext` only when the person engages the agent; it accepts the
API on `document`, `navigator`, or `window`, falls back to `provideContext` for hosts
without `registerTool`, and flips to active the moment any tool executes. For manual
testing without an agent, registered tools are exposed on the console as
`__unfoldedTools` (e.g. `__unfoldedTools.set_capacity.execute({capacityMl: 350})`).

The in-app guide at [`/webmcp`](https://tryunfolded.com/webmcp)
explains all of this to visitors, with live connection status for their own browser.

## WebMCP tools

Registered via `document.modelContext.registerTool` (with a `navigator.modelContext`
fallback for browsers that expose the API there — see
[`src/mcp/tools.ts`](./src/mcp/tools.ts)):

<!-- keep in sync with TOOL_SUMMARIES in src/mcp/tools.ts (the single source
     the /webmcp page renders) — README can't import, so this table is manual -->
| Tool | What it does |
|---|---|
| `describe_project` | Read the current design, clay, template pieces, capacity (ml), and its share link |
| `open_model` | Open a design from a share link the user pastes in chat, then keep editing it |
| `update_form` | Change shape / taper / facets / height / diameters (fired mm) — any shape can be straight or tapered |
| `set_clay` | Change shrinkage % and wall thickness |
| `set_capacity` | Solve the height for a target interior volume ("make it 350 ml") |
| `set_units` | Switch display units between cm and inches — UI, warnings, and the printed PDF |
| `get_template_summary` | Template layout, per-piece dimensions, exact PDF page count |
| `get_preview_image` | PNG snapshot of the live 3D preview — the agent sees what the potter sees |
| `export_templates` | Generate and download the multi-page PDF (A4 / A3 / Letter) |
| `apply_preset` | Start from a preset (classic mug, tumbler, bud vase, hex planter) |
| `join_session` | Pair this tab into a live cross-device session using the 6-character code from the potter's other device |
| `start_pairing` | Mint a 6-character code so the potter's other device can join this design's live session |
| `undo_last_change` | Revert the last change, whoever made it (up to 50 steps) |

UI and agent tools share the same zustand store and zod schemas, so human and agent
edits stay in sync in the same session. Every mutating tool returns the full new
state — including `capacityMl` (ask for *"a 350 ml mug"* and the agent iterates until
it matches) and `shareUrl` (the agent can always hand the current design's link back
into the chat).

Things to try in a WebMCP-capable browser:

> *"What am I designing right now?"*
> *"Make it a hexagonal planter, 18 cm tall and 14 cm wide."*
> *"My stoneware shrinks 13% — adjust and tell me the fired sizes."*
> *"Make it hold about 350 ml, show me how it looks, then export the PDF for Letter paper."*

## Sync live between devices

A design doesn't live in one chair. **Pair a device** (the two-screens icon in
the header) shows a **6-character code** — read it to your other device, or
tell your agent *"join my desktop session, code K7F-3QP"* (`join_session`).
The reverse works too: ask the agent for a code (`start_pairing`) and type it
on the desktop. One rule: **the device that enters the code follows the other
one's design** (a single undo brings its previous design back); afterwards
both are live peers — every edit by you or the agent, on either device,
appears everywhere within about a second. Phones freezing background tabs is
expected: every return to the tab reconnects and converges, and edits made
offline are kept and sent.

Codes are honest capabilities: **5 minutes, one use**, from an alphabet with
no ambiguous glyphs (never `I L O 0 1`) — anyone who enters one in that
window can edit that design live, and nothing else. Privacy stays simple:
the design parameters are the only thing that ever leaves the device,
sessions are unlisted and expire after 30 idle days, and **no URL is ever a
live capability** — share links, the address bar, and the printed QR stay
plain design parameters (a found template grants a copy, not entry to your
session).

Three ways this plays out: start on the desktop and continue with the agent
on the phone; start with the agent and bring the design to the desktop with
an agent-minted code; or months later, scan the QR printed **inside the
largest template piece** — it survives the overview page being binned — and
re-derive the same design for a new clay body.

## Share links

Every design is a URL. Query parameters describe the whole model, so a link like

```
https://<deployment-host>/?type=tapered&height=600&bottom=300&top=100&shrinkage=12&wall=5
```

opens the app with that exact form (`type` also accepts `triangle`, `square`,
`pentagon`, `hexagon`; `name`, `paper=A4|A3|Letter`, and `units=cm|in` work too — the
model itself stays metric, `units` only sets how measurements are displayed and
printed). After the first edit
the address bar live-tracks the design, the header's link button copies it, and the
`open_model` tool lets an agent continue from any pasted link. Links are
origin-independent — they survive domain changes — and parameter-only: opening
one grants a copy of the design, never entry to a live session.

## How the math works

Slab-built forms are developable surfaces, so templates come from closed-form
unrolling (no mesh solver): cylinders → rectangles, cone frustums → annular sectors,
prisms → flat panels, tapered prisms (pyramid frustums) → trapezoid panels with the
miter bevel recomputed for the lean of the faces.
Two pottery-specific corrections are applied — clay shrinkage scaling (`1/(1−s)`) and
mid-surface development (`r − t/2`). See
[`src/lib/geometry/unroll.ts`](./src/lib/geometry/unroll.ts).

## Deploy

Hosted on Cloudflare (Workers static assets). Every push to `main` deploys via
GitHub Actions (`.github/workflows/deploy.yml`); it needs the `CLOUDFLARE_API_TOKEN`
and `CLOUDFLARE_ACCOUNT_ID` repo secrets. Manual deploy: `npm run build && npx wrangler deploy`.

Share links, WebMCP tools, and the app itself are origin-independent; the only
place the deployed domain is written down is `VITE_SITE_URL` in [`.env`](./.env)
(used for the absolute `og:*` meta tags). Moving domains is a one-line change.

## License

[MIT](./LICENSE)
