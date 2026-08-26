# Unfolded — Slab Pottery Template Designer with WebMCP

A web app where potters design slab-built forms (mugs, vases, boxes) as parametric 3D
objects, preview them live, and export **true-scale, multi-page printable templates**
they can tape together and cut. The whole app state is exposed through **WebMCP tools**
(`document.modelContext`), so an agent — e.g. ChatGPT's in-app browser, which supports
WebMCP natively — can edit the same design the user sees on screen, in the same session.

Built for the **WebMCP Challenge** (Devpost, deadline Sep 3 2026) — see §10 for
submission requirements.

---

## 1. The core insight (what makes this feasible in a hackathon)

Slab pottery is built from flat sheets of clay, which means every buildable form is a
**developable surface** — a surface that unrolls to a flat shape with zero distortion.
That reduces the whole product to three well-understood problems:

1. **Parametric modeling** of forms made of developable pieces (cylinders, cones,
   flat panels) — not free-form sculpting.
2. **Unrolling** those pieces with closed-form math (no mesh-flattening solver needed).
3. **Tiling** the flat pieces onto printable pages at exact physical scale.

We deliberately do *not* build a general 3D editor. The user edits **parameters and a
profile curve**; the 3D view is a live preview. This is both easier to build and a far
better fit for MCP tools (structured parameters ≫ "move vertex 372").

## 2. Form types (in build order)

| Form | Geometry | Unrolls to |
|---|---|---|
| Cylinder mug | cylinder + disc base | rectangle + circle |
| Tapered tumbler | cone frustum + disc | annular sector + circle |
| Faceted mug/vase | N-sided prism/antiprism-ish taper | N trapezoids + polygon base |
| Curved-profile vase | user-drawn profile, approximated | see strategies below |
| (stretch) Oval baker / box | flat panels + wrapped wall | rectangles/panels |
| (stretch) Handle | flat strap with length annotation | rectangle strip |

**Curved profile strategies** (both are real slab techniques — make it a user choice):
- **Stacked bands**: approximate the profile with K frustum bands → K annular sectors.
  Fewer seams per band, horizontal seam lines.
- **Vertical staves (gores)**: N identical vertical strips; at each height the strip
  half-width is `π·r(z)/N`, laid out along the profile arc length. Classic "orange peel"
  development, vertical seams.

## 3. The math (all closed-form)

- **Cylinder** radius r, height h → rectangle `2πr × h`.
- **Frustum** radii r1 (top), r2 (bottom), height h:
  - slant `l = √((r2−r1)² + h²)`
  - apex slant radii `L2 = r2·l/(r2−r1)`, `L1 = L2 − l`
  - sector angle `θ = 2π·r2/L2`
  - piece = annular sector between L1 and L2 over angle θ. (r1 = r2 falls back to rectangle.)
- **Gore**: sample profile r(z); x-axis = arc length `s(z) = ∫√(1+r′(z)²)dz`,
  half-width `w(s) = π·r(z)/N`. Mirror for the full gore.
- **Base**: circle of radius r_base (or polygon for faceted forms), sized to the *inner*
  wall so the wall wraps around it (potter convention; make it a toggle).

### Pottery-specific corrections (the differentiator — get these right)

- **Clay shrinkage**: clay shrinks ~8–15% from wet to fired. User enters their clay's
  shrinkage s; all templates scale by `1/(1−s)` so the *fired* piece matches the design.
  Show both "wet size" and "fired size" in the UI.
- **Wall thickness** t: develop the **mid-surface** (`r_mid = r_outer − t/2`), not the
  outer skin — otherwise wrapped slabs come out oversized.
- **Seam/joint annotations**: mark join edges, recommended 45° bevel edges, and
  registration tick marks across seams so pieces align when wrapping.
- **Labels**: every piece labeled ("Wall A", "Base"), with grain-direction arrow
  (slabs have memory) and "this edge joins edge X" notes.

## 4. Print/export pipeline

1. Geometry → **SVG pieces in millimeters** (1 user unit = 1 mm). SVG is the single
   source of truth for export.
2. **Layout**: simple shelf/row packing of piece bounding boxes onto a virtual sheet
   (don't burn hackathon time on optimal nesting).
3. **Pagination**: split the sheet into A4/Letter pages (user choice) with:
   - printable margins + **10 mm glue overlap** strips
   - crop marks and page IDs on a grid ("B2"), tape-order assembly map on page 1
   - **calibration ruler** (100 mm bar + 1-inch bar) on page 1 with a bold
     "print at 100% / no scaling" warning — the #1 failure mode of printable templates
4. **PDF generation** client-side with `jsPDF` + `svg2pdf.js` (vector output, exact mm
   page sizes). Fallback/quick path: browser print of paginated pages via print CSS —
   but PDF is the reliable true-scale route; do PDF.

## 5. Tech stack

| Concern | Choice | Why |
|---|---|---|
| Framework | **Vite + React 19 + TypeScript** | Pure client-side SPA — WebMCP is a browser API, no server needed; fastest hackathon loop. (Next.js adds nothing here.) |
| UI | **Tailwind v4 + shadcn/ui** | As requested; sliders, number inputs, dialogs, sidebar all off the shelf. |
| 3D preview | **three.js via @react-three/fiber + @react-three/drei** | The best React 3D option, period. `LatheGeometry` gives the revolve preview almost for free; drei's `OrbitControls`, `Stage`, `Grid` make it look good in minutes. |
| Profile editor | Custom 2D SVG editor (drag control points on a Catmull-Rom/Bézier profile) | Small, and it *is* the product's key interaction. |
| State | **zustand** (+ `zundo` for undo/redo) | One store = single source of truth for UI **and** MCP tools — this is what makes "same session" editing work. |
| Validation | **zod** | Shared schemas: form params, MCP tool inputs, store actions. |
| WebMCP | **native `document.modelContext.registerTool`** (thin typed wrapper of our own) | The hackathon's target environments (ChatGPT in-app browser; Chrome with `#enable-webmcp-testing`) ship the API natively, and the required code shape must appear in the repo. No polyfill or bridge needed. |
| Hosting | **Vercel** (static Vite build, auto-deploy from GitHub) | Hackathon sponsor; account already connected to this Claude session so setup is zero-touch; judges just need a live URL. |
| PDF | **jsPDF + svg2pdf.js** | Vector, exact mm scale, client-side. |
| Tests | vitest on `src/lib/geometry` | The unfold math is pure functions — cheap to test, embarrassing to get wrong in a demo. |

## 6. Architecture

```
src/
  lib/
    model/        # zod schemas: Project, Form, Profile, ClaySettings
    geometry/     # PURE functions: profile sampling, unroll (cylinder/frustum/gore),
                  # shrinkage/mid-surface transforms, piece layout, pagination
    export/       # SVG builder, jsPDF pipeline
  store/          # zustand store + actions (the ONLY way state changes)
  mcp/            # WebMCP tool registrations — thin wrappers over store actions
  components/
    viewport/     # R3F canvas: lathe/panel meshes, seam highlights
    profile/      # 2D profile curve editor
    panels/       # parameter sidebar (shadcn), clay settings, export dialog
    print/        # template preview (rendered SVG pages)
```

**Key rule**: UI components and MCP tools both call the *same store actions*. Neither
touches geometry directly. That guarantees chat edits and GUI edits are always in sync,
undo/redo covers both, and every MCP tool is trivially testable.

## 7. WebMCP tool surface (design for the LLM, not for us)

Few tools, rich descriptions, structured returns. Every mutating tool returns a compact
JSON state summary so the model doesn't need a follow-up read.

- `describe_project()` → current form type, all parameters, clay settings, piece list
  with dimensions. (The model's "eyes".)
- `create_form({ type, name?, params? })` → start a mug/tumbler/faceted/curved form.
- `update_form({ height?, topDiameter?, bottomDiameter?, facets?, strategy?, bands?, gores? })`
  → partial parameter update, clamped + validated by zod; returns new state + warnings
  (e.g. "wall taper exceeds what a slab can wrap without darts").
- `set_profile({ points: [{z, r}] })` → replace the profile curve for curved forms.
- `set_clay({ shrinkagePct?, wallThicknessMm?, seamAllowanceMm? })`
- `get_template_summary()` → pieces, their flat dimensions, page count at current paper size.
- `export_templates({ paperSize?: "A4"|"Letter" })` → triggers the PDF download, returns
  page count + assembly summary.

Registration goes through the **native API directly** — the exact shape the hackathon
requires in the repo:

```js
document.modelContext.registerTool({
  name: "update_form",
  description: "...",
  inputSchema: { /* JSON Schema, generated from our zod schemas */ },
  execute: async (input) => { /* calls store actions, returns state summary */ }
});
```

Tool handlers call store actions and read back `describeState()`. Feature-detect
`document.modelContext` and show a status badge (native / unavailable) in the UI.

**How judges run it (per hackathon rules)**: ChatGPT's in-app browser supports WebMCP
out of the box; Google Chrome supports it behind `chrome://flags/#enable-webmcp-testing`.
No bridge extension, no remote MCP server — everything is in-page. Test in both
environments from day 1.

## 8. Build plan (ordered, each milestone demoable)

**M1 — Parametric core + 3D preview** (foundation)
Vite/Tailwind/shadcn scaffold · model schemas + store · parameter sidebar ·
R3F viewport with lathe preview for cylinder/frustum. *Demo: drag sliders, mug changes.*

**M2 — Unfold engine + template view**
`unrollCylinder`, `unrollFrustum`, base disc · shrinkage + mid-surface transforms ·
SVG piece rendering with labels/seam marks · vitest on the math ·
split view: 3D left, flat template right, live-linked. *Demo: the "aha" moment.*

**M3 — Multi-page PDF export**
Layout + pagination + glue overlaps + crop marks + calibration ruler + assembly map ·
jsPDF/svg2pdf pipeline. *Demo: print A4 pages, tape, cut — bring a real paper template
(and ideally a slab-built mug made from one) to judging.*

**M4 — WebMCP integration**
Native `document.modelContext` tool registrations · `describe_project`/`update_form`/
`export_templates` first, rest after · verify end-to-end in ChatGPT's in-app browser and
Chrome with the WebMCP flag · a "🔌 agent tools registered / last tool call" indicator
in the UI (great for demo). 

**M5 — Curved vase + polish** (only after M4 works)
Profile curve editor · gore + band unrolling · faceted forms · warnings/guardrails ·
empty states, presets ("classic mug", "bud vase"), landing copy.

**Priority rule**: M1→M4 is the fundable demo. M5 is where the wow is, but a cylinder
mug edited by ChatGPT and printed on 4 taped pages already tells the whole story.
If time is short, cut curved forms before cutting the WebMCP polish.

## 9. Demo script (3 minutes)

1. Open app: mug preset in 3D, template pieces beside it.
2. In chat: *"Make it a 350 ml tumbler, tapered, and use my stoneware at 12% shrinkage"*
   → watch parameters, 3D, and templates update live on screen.
3. *"Export it for A4"* → PDF downloads, flip through pages, show calibration ruler.
4. Hold up the pre-made taped/cut paper template + (ideally) the actual clay piece.
5. One closing line on WebMCP: "no screenshots, no DOM scraping — the site hands the
   agent real tools."

## 10. Hackathon submission checklist (deadline: Sep 3, 2026)

- [ ] Live URL (Vercel) that works in ChatGPT's in-app browser and Chrome with
      `chrome://flags/#enable-webmcp-testing`
- [ ] Open-source **LICENSE file (MIT)** — must be detectable in the repo About section
- [ ] Repo contains `document.modelContext.registerTool({...})` usage, all source,
      and run instructions in the README
- [ ] Text description: why WebMCP fits (structured parametric edits ≫ UI guessing),
      the human+agent collaboration story, implementation summary
- [ ] Demo video: <3 min, public YouTube, with audio
- Judging criteria to optimize: **WebMCP Leverage** (deep, non-trivial tool surface —
  our whole design is tool-first), **Execution** (complete product, not a PoC — the
  printed/taped template closes the loop), **Impact** (real audience: slab potters),
  **Creativity** (physical-world output is rare in this space)

## 11. Risks & mitigations

- **Judge-environment surprises** → test in ChatGPT's in-app browser from day 1 (it's
  the primary judging surface); record a backup screen capture of the full flow.
- **Print scale drift** → calibration ruler on page 1; instructions overlay; test on a
  real printer early.
- **Scope creep in 3D** → viewport is *read-only preview*; all editing via parameters,
  profile editor, or chat. No gizmos, no mesh editing.
- **Curved-form math time sink** → gore/band code is isolated in `lib/geometry`; ship
  without it if needed.
