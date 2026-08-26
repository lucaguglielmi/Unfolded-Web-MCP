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

Registered via `document.modelContext.registerTool` (see [`src/mcp/tools.ts`](./src/mcp/tools.ts)):

| Tool | What it does |
|---|---|
| `describe_project` | Read the current design, clay settings, and template pieces |
| `update_form` | Change form type / height / diameters (fired mm) |
| `set_clay` | Change shrinkage %, wall thickness, seam allowance |
| `apply_preset` | Start from a preset (classic mug, tumbler, bud vase) |

UI and agent tools share the same zustand store and zod schemas, so human and agent
edits stay in sync in the same session.

## How the math works

Slab-built forms are developable surfaces, so templates come from closed-form
unrolling (no mesh solver): cylinders → rectangles, cone frustums → annular sectors.
Two pottery-specific corrections are applied — clay shrinkage scaling (`1/(1−s)`) and
mid-surface development (`r − t/2`). See
[`src/lib/geometry/unroll.ts`](./src/lib/geometry/unroll.ts).

## License

[MIT](./LICENSE)
