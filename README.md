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

## Run it

```bash
npm install
npm run dev      # local dev server
npm test         # unrolling-math unit tests
npm run build    # type-check + production build
```

Open the app in a WebMCP-capable browser:

- **ChatGPT's in-app browser** — WebMCP works out of the box
- **Google Chrome** — enable `chrome://flags/#enable-webmcp-testing`

The header badge shows whether WebMCP tools are registered and the last tool an agent
called.

## WebMCP tools

Registered via `document.modelContext.registerTool` (with a `navigator.modelContext`
fallback for browsers that expose the API there — see
[`src/mcp/tools.ts`](./src/mcp/tools.ts)):

| Tool | What it does |
|---|---|
| `describe_project` | Read the current design, clay, template pieces, capacity (ml), and its share link |
| `open_model` | Open a design from a share link the user pastes in chat, then keep editing it |
| `update_form` | Change shape / taper / facets / height / diameters (fired mm) — any shape can be straight or tapered |
| `set_clay` | Change shrinkage % and wall thickness |
| `get_template_summary` | Template layout, per-piece dimensions, exact PDF page count |
| `get_preview_image` | PNG snapshot of the live 3D preview — the agent sees what the potter sees |
| `export_templates` | Generate and download the multi-page PDF (A4 / Letter) |
| `apply_preset` | Start from a preset (classic mug, tumbler, bud vase, hex planter) |
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

## Share links

Every design is a URL. Query parameters describe the whole model, so a link like

```
https://<deployment-host>/?type=tapered&height=600&bottom=300&top=100&shrinkage=12&wall=5
```

opens the app with that exact form (`type` also accepts `triangle`, `square`,
`pentagon`, `hexagon`; `name` and `paper=A4|Letter` work too). After the first edit
the address bar live-tracks the design, the header's link button copies it, and the
`open_model` tool lets an agent continue from any pasted link. Links are
origin-independent — they survive domain changes.

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

## License

[MIT](./LICENSE)
