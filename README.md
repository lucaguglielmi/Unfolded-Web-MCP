# Unfolded

**Slab pottery templates: design in 3D, print flat, build in clay.**

**Live: [tryunfolded.com](https://tryunfolded.com)** · guide at
[/webmcp](https://tryunfolded.com/webmcp) · story at
[/why](https://tryunfolded.com/why)

[![Deploy](https://github.com/lucaguglielmi/Unfolded-Web-MCP/actions/workflows/deploy.yml/badge.svg)](https://github.com/lucaguglielmi/Unfolded-Web-MCP/actions/workflows/deploy.yml)
[![npm: webmcp-profiler](https://img.shields.io/npm/v/webmcp-profiler?label=webmcp-profiler)](https://www.npmjs.com/package/webmcp-profiler)
[![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

![Unfolded: parametric form, live 3D preview, and flat templates side by side](./docs/assets/screenshot.png)

Unfolded lets potters design slab-built forms (mugs, tumblers, vases, planters) as
parametric 3D objects and turns them into true-scale printable templates to cut,
tape, and lay on a clay slab. Every dimension is shrinkage-compensated for your clay
body and developed along the slab mid-surface, so the fired piece matches the design.

The whole app is WebMCP-native: it registers its editing tools on
`document.modelContext`, so an agent (for example ChatGPT's built-in browser) can
inspect and edit the same design you see on screen while the 3D preview and
templates update live.

## Why this exists

I cut pottery templates out of cereal boxes for years. AI chat is great at shapes
and unusual requirements, but asking it to draw the printable template directly
produces misaligned PDFs that fail silently: the potter finds out hours into the
build, or after the firing. The manual version bites the same way. Shrinkage gets
scaled by the intuitive `1+s` when a template must grow by `1/(1−s)`, leaving every
dimension short, and walls get measured on the outer surface when a bent slab
actually develops along its middle (`r − t/2`).

Unfolded moves the template out of the chat and into deterministic code: shrinkage
scaled the right way, mid-surface development, exact interior capacity (volume is
linear in height, so "make it hold 350 ml" has a closed-form answer), true miter
bevels for tapered faceted forms, and page tiling with a calibration bar on every
sheet. The AI stays for the asks no deterministic UI can absorb: "keep the style
but make it 500 ml", "a template inspired by this photo, porcelain, thin walls",
"this should hold a large americano comfortably". The agent chooses the parameters;
the geometry is always right.

## Verify in 60 seconds

The live app is **<https://tryunfolded.com>**: no account, no setup. Open it in
ChatGPT's built-in browser and the agent has all 14 tools immediately. In Google
Chrome (desktop and Android), enable `chrome://flags/#enable-webmcp-testing`; the
app shows a one-time tip with that address when it detects real Chrome without
WebMCP. To verify the repo from a clean checkout:

```bash
npm ci
npx playwright install chromium   # for the e2e suites
npm run lint
npm test          # unit suites: geometry, schemas, sync client, profiler
npm run build
npm run e2e       # real Chromium against the production bundle + a simulated WebMCP host
```

Two deeper suites exercise the live-session backend; each starts its own local
Cloudflare Worker (`wrangler dev --local`, bundled as a dev dependency):

```bash
npm run e2e:worker    # Durable Object protocol smoke, join tokens, origin guard, headers
npm run e2e:pairing   # two real browsers pairing, converging, and surviving offline
```

Three prompts to try against the live site in ChatGPT, and what should happen:

1. *"What am I designing right now?"* One `describe_project` call; the agent
   answers with the current shape, sizes, capacity in ml, and a design link.
2. *"Make it hold about 350 ml and show me how it looks."* `set_capacity` solves
   the height in closed form (no guess loop), then `get_preview_image` returns
   the same 3D view the potter sees.
3. *"Export the PDF for A4."* `export_templates` downloads a multi-page,
   100%-scale template with a calibration ruler; the agent reports the page count.

For development: `npm run dev` starts the local server; `npm run perf` benchmarks
tool execution time and payload size.

## Under the hood

Everything below lives in [`src/mcp/`](./src/mcp/) and the [`worker/`](./worker/)
directory, covered by the committed test suites:

- **Fourteen tools with real contracts.** Zod-validated inputs exported as JSON
  Schema, current-draft descriptors, host cancellation signals honored, and
  graceful error results that include the unchanged state, plus a parseable
  `structuredContent` half (`tool-result/1`).
- **Every design-changing tool returns the full new state**, PDF export included,
  so the agent never needs a follow-up read. Snapshots carry a permanent
  `designUrl`; the return channel is `create_live_handoff`, which mints a
  single-use `liveHandoffUrl` and fails closed.
- **A solver, not just setters.** `set_capacity` computes the exact height for a
  target volume in one call instead of letting the agent iterate.
- **The agent sees what the potter sees.** `get_preview_image` returns the live
  WebGL canvas as a compact JPEG (about 7 KB; it was a 130 KB PNG until the
  built-in profiler flagged it as the costliest payload in the loop).
- **Never-give-up registration.** Hosts inject `modelContext` at wildly different
  times (ChatGPT only when the person engages the agent), so the app watches
  forever: fast polling, then a heartbeat paused in hidden tabs, plus focus and
  visibility re-checks, with a legacy compatibility layer for older hosts.
- **Human and agent are true peers.** Same store, same validation, and shared
  undo over both actors' edits, whatever device pushed them.
- **Live cross-device sessions.** One Durable Object per session over WebSockets,
  patches in the share-link vocabulary, per-field last-write-wins, cross-site
  origins rejected at the worker, and security headers on every response.
  Invitations are single-use and short-lived, so no URL ever carries a durable
  capability.

## WebMCP tools

Registered on `document.modelContext` per the current WebMCP draft (legacy
`navigator`/`window` locations accepted for compatibility; see
[`src/mcp/tools.ts`](./src/mcp/tools.ts)):

<!-- keep in sync with TOOL_SUMMARIES in src/mcp/tools.ts (the single source
     the /webmcp page renders); README can't import, so this table is manual -->
| Tool | What it does |
|---|---|
| `describe_project` | Read the current design, clay, template pieces, capacity (ml), and its permanent design link |
| `open_model` | Open a design from a share link the user pastes in chat, then keep editing it |
| `update_form` | Change shape, taper, facets, height and diameters (fired mm); any shape can be straight or tapered |
| `set_clay` | Change shrinkage % and wall thickness |
| `set_units` | Switch display units between cm and inches, in the UI and the printed PDF |
| `set_capacity` | Solve the height for a target interior volume ("make it 350 ml") |
| `get_template_summary` | Template layout, per-piece dimensions, exact PDF page count |
| `get_preview_image` | Compact JPEG snapshot of the live 3D preview, exactly what the potter sees |
| `export_templates` | Generate and download the multi-page PDF (A4 / A3 / Letter) |
| `apply_preset` | Start from a preset (classic mug, tumbler, bud vase, hex planter) |
| `create_live_handoff` | Mint the single-use live link that continues this design on the potter's own screen, the default link after any edit |
| `join_session` | Pair this tab into a live cross-device session using the 6-character code from the potter's other device |
| `start_pairing` | Mint a 6-character code so the potter's other device can join this design's live session |
| `undo_last_change` | Revert the last change, whoever made it (up to 50 steps) |

**Two links, never confused.** `designUrl` reopens an independent copy: parameters
only, bookmarkable, printable months later; it is also the address bar and the
printed QR. `liveHandoffUrl` comes only from `create_live_handoff`: the same
parameters plus a single-use join token, so the tab that opens it follows the
agent's session both ways. The tool descriptions make the live link the default
for any "send me the link" ask, returned verbatim and never substituted with the
address bar; a failed mint yields no link at all.

## Work with an agent from any browser

The potter's browser needs no WebMCP at all; Safari works fine. The header's
connection button carries two status dots, agent and live sync, and tells the
truth about both: a ChatGPT connection is shown only on an explicit agent-minted
link signal, never inferred from the user agent. One tap on **Open in ChatGPT**
injects a ready-made prompt with a fresh single-use pairing code into a new chat
(on phones the link hands off into the ChatGPT app); **Copy prompt** puts the same
text on the clipboard for any other assistant. The agent opens the site in its own
hidden browser, joins with the code, and becomes a live peer: its edits land in
your tab within about a second, your edits reach it on its next tool call, and
every change is one undo step for both sides.

Invitations expire in 15 minutes and burn on first use. Sessions are unlisted and
expire after 30 idle days. The QR printed inside the largest template piece stays
parameter-only, so a found template grants a copy of the design, never entry to a
session. For manual testing without an agent, the registered tools are exposed on
the console as `__unfoldedTools`.

## Share links

Every design is a URL. Query parameters describe the whole model:

```
https://<deployment-host>/?type=tapered&height=600&bottom=300&top=100&shrinkage=12&wall=5
```

The address bar live-tracks the design after the first edit, `open_model` lets an
agent continue from any pasted link, and links are origin-independent and
parameter-only: opening one grants a copy, never entry to a live session.

## How the math works

Slab-built forms are developable surfaces, so templates come from closed-form
unrolling with no mesh solver: cylinders to rectangles, cone frustums to annular
sectors, prisms to flat panels, tapered prisms to trapezoid panels with the miter
bevel recomputed for the lean. Clay shrinkage scaling (`1/(1−s)`) and mid-surface
development (`r − t/2`) are applied on top. See
[`src/lib/geometry/unroll.ts`](./src/lib/geometry/unroll.ts).

## Built-in performance profiler

The repo ships [`webmcp-profiler`](./packages/webmcp-profiler), a zero-dependency
analyser for any WebMCP tool surface, on
[npm](https://www.npmjs.com/package/webmcp-profiler). Open the live app with
`?perf=overlay` and every tool call is measured: wall time, main-thread blocking,
payload bytes and estimated tokens, and the host "think time" between calls. Its
first finding (the tools run in single-digit milliseconds; an oversized preview
payload was the real cost) is fixed above.

## Deploy

Hosted on Cloudflare Workers static assets. Every push to `main` deploys via
GitHub Actions (`.github/workflows/deploy.yml`) using the `CLOUDFLARE_API_TOKEN`
and `CLOUDFLARE_ACCOUNT_ID` repo secrets. Manual deploy:
`npm run build && npx wrangler deploy`. The only place the deployed domain is
written down is `VITE_SITE_URL` in [`.env.example`](./.env.example); every `VITE_`
value is inlined into the client bundle, so no `.env` here may hold a secret.

## Deeper reading

- [`docs/user-flow.md`](./docs/user-flow.md): continuing a design across screens,
  scenario by scenario
- [`docs/live-sync-spec.md`](./docs/live-sync-spec.md): the live-session protocol,
  pairing, and threat model
- [`docs/live-handoff-link-spec.md`](./docs/live-handoff-link-spec.md): the
  two-link contract and `create_live_handoff`
- [`docs/performance-report.md`](./docs/performance-report.md): the app-wide audit
- [`docs/webmcp-tool-performance-spec.md`](./docs/webmcp-tool-performance-spec.md):
  proposed — fewer round trips per request, lighter results, no discovery gap
- [`docs/webmcp-profiler-spec.md`](./docs/webmcp-profiler-spec.md) and
  [`docs/webmcp-profiler-0.2-spec.md`](./docs/webmcp-profiler-0.2-spec.md): the
  profiler's design and its next release

## License

[MIT](./LICENSE)
