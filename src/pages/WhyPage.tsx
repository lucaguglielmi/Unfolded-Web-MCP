import { useState } from "react"
import { ArrowUpRight } from "lucide-react"
import { ExplainerHeader } from "@/components/ExplainerHeader"
import { useDesignHref, useStudioHref } from "@/lib/useStudioHref"
import { ReadingDepthToolbar, type ReadingDepth } from "@/components/ReadingDepthToolbar"
// the tool list renders from its single source next to the registrations
import { TOOL_SUMMARIES } from "@/mcp/tools"

/**
 * /why — the README, told as a page, at the reader's chosen depth. A small
 * toolbar asks how much time you have: "1 minute" is a digest, "5 minutes"
 * (default) is the full README story, and "I am not human" addresses the
 * agent reading the page directly, with every contract, range, and formula
 * it needs. Same quiet, white, typographic language as /webmcp.
 */

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground/80 uppercase">{children}</p>
  )
}

function Code({ children }: { children: string }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground/80">
      {children}
    </code>
  )
}

/* ------------------------------------------------------------ 1 minute */

const DIGEST: { title: string; body: string }[] = [
  {
    title: "What it is",
    body: "A parametric 3D designer for slab-built pottery. Design the fired piece; print true-scale templates to cut, tape, and lay on clay.",
  },
  {
    title: "Why it exists",
    body: "The paper step of slab building is still done by hand, on cereal-box cardboard — and it bites in predictable ways: shrinkage scaled by 1+s instead of 1/(1−s), walls measured on the outer surface instead of the slab's middle, capacity guessed, printing mis-tiled. Every error shows up only after the firing. Unfolded encodes the right math.",
  },
  {
    title: "The AI part",
    body: "WebMCP-native: an agent browsing with you gets thirteen typed tools and edits the same live design — \"make it hold 350 ml\" is one exact call, not a guessing loop.",
  },
  {
    title: "The output",
    body: "A PDF that prints at 100% scale on A4, A3, or Letter, with glue overlaps, bevel angles, a calibration bar on every page, and a QR that reopens the exact design.",
  },
  {
    title: "Links are designs",
    body: "The whole model lives in the URL — share it, scan it, or paste it to an agent to keep editing.",
  },
  {
    title: "It follows you around",
    body: "Scan a QR, tap a link your agent hands you, or read a 6-character code aloud — the other screen (no WebMCP needed) follows the same live design within a second, edits flowing both ways.",
  },
  {
    title: "The deal",
    body: "Free for everyone, forever. Open source, MIT.",
  },
]

function OneMinute() {
  return (
    <>
      <section className="pt-12 pb-4">
        <h1 className="max-w-xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          Design in 3D, <span className="text-[#0A5BFF]">print flat</span>, build in clay.
        </h1>
      </section>
      <section className="py-8">
        <dl className="space-y-6">
          {DIGEST.map(({ title, body }) => (
            <div key={title} className="max-w-xl">
              <dt className="font-semibold tracking-tight text-foreground">{title}</dt>
              <dd className="mt-1 leading-relaxed text-foreground/75">{body}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-10 text-sm text-muted-foreground/80">
          That's the minute. Switch to the five-minute read for the full story — or open the
          studio and just try it.
        </p>
      </section>
    </>
  )
}

/* ------------------------------------------------------------ 5 minutes */

const NON_TRIVIAL: { title: string; body: string }[] = [
  {
    title: "Thirteen tools with real contracts",
    body: "zod-validated inputs exported as JSON Schema, honest annotations (read-only / idempotent / destructive hints), and graceful error results that include the unchanged state.",
  },
  {
    title: "Every mutation returns the full new state",
    body: "so the agent never needs a follow-up read — and every snapshot carries a share link, which doubles as the return channel: a page can't push text into a chat, but the agent can always hand the potter a link that reopens the exact design.",
  },
  {
    title: "A solver, not just setters",
    body: "set_capacity computes the exact height for a target volume in one call instead of letting the agent iterate toward it.",
  },
  {
    title: "The agent sees what the potter sees",
    body: "get_preview_image returns the live 3D canvas as an image, so the agent can visually confirm its own changes.",
  },
  {
    title: "Never-give-up registration",
    body: "hosts inject the WebMCP API at wildly different times — ChatGPT only when the person engages the agent — so the app watches forever: fast polling, then a heartbeat (paused in hidden tabs), plus focus and visibility re-checks, across document, navigator, and window, with a provideContext fallback.",
  },
  {
    title: "An honest connection model",
    body: "the three-state pill never guesses: direct registration, an explicit agent-minted link signal, or nothing. No user-agent sniffing, ever.",
  },
  {
    title: "Human and agent are true peers",
    body: "same store, same validation, shared undo/redo over both actors' edits, and concurrent PDF exports counted rather than flag-locked.",
  },
  {
    title: "The design doesn't live in one chair",
    body: "start at the bench, continue in chat, come back months later from the QR printed with the template — a scanned QR, a tapped agent link, or a spoken code pairs any two screens into one live session. Invitations are single-use and short-lived (a used link degrades to a plain design link), so no URL ever carries a durable capability, and the printed QR stays parameter-only.",
  },
]

const UNROLLINGS = [
  ["Cylinder", "rectangle"],
  ["Cone frustum", "annular sector"],
  ["Prism", "flat panels"],
  ["Tapered prism", "trapezoid panels, miter bevel recomputed for the lean"],
]

function FiveMinutes() {
  const webmcpHref = useDesignHref("/webmcp")
  return (
    <>
      {/* hero */}
      <section className="pt-12 pb-16">
        <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Design in 3D, <span className="text-[#0A5BFF]">print flat</span>, build in clay.
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
          Unfolded lets potters design slab-built forms — mugs, tumblers, vases, planters — as
          parametric 3D objects and turns them into true-scale printable templates to cut,
          tape, and lay on a clay slab. Every dimension is shrinkage-compensated for your clay
          body and developed along the slab mid-surface, so the fired piece matches the design.
        </p>
        <p className="mt-4 max-w-xl leading-relaxed text-muted-foreground">
          And the whole app is WebMCP-native: an AI agent browsing alongside you can inspect
          and edit the same design you see on screen — <em>&ldquo;make it a 350&nbsp;ml
          tumbler and use my stoneware at 12% shrinkage&rdquo;</em> — while the 3D preview and
          templates update live.
        </p>
      </section>

      {/* why this exists */}
      <section className="border-t border-border/60 py-14">
        <SectionLabel>Why this exists</SectionLabel>
        <p className="mt-5 max-w-xl leading-relaxed text-foreground/75">
          Slab building is the most common hand-building technique in ceramics, and its paper
          step is still manual: potters draw templates on cereal boxes, wrap paper around
          forms, and do the sizing math by hand. The math is genuinely hard, two errors are
          endemic — both ruin pieces only <em>after</em> the firing — and even when everything
          is right, the workflow fights you:
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-border p-6">
            <h3 className="font-semibold tracking-tight">Capacity math under constraints</h3>
            <p className="mt-3 text-sm leading-relaxed text-foreground/75">
              &ldquo;How much will it hold?&rdquo; is already awkward math for a straight
              cylinder — add a taper, wall thickness, and shrinkage, then pin a constraint like
              a fixed height or a silhouette you love, and solving for an exact volume by hand
              turns into guesswork. Most potters settle for &ldquo;close enough&rdquo;.
            </p>
          </div>
          <div className="rounded-2xl border border-border p-6">
            <h3 className="font-semibold tracking-tight">Hard shapes, wrong PDFs</h3>
            <p className="mt-3 text-sm leading-relaxed text-foreground/75">
              A tapered hexagon or a flared pentagon is hard to visualize and harder to unroll
              by hand — and asking an AI chat to generate the template PDF fails most of the
              time: non-deterministic output, wrong bevels, and broken tiling the moment a
              piece spans multiple pages.
            </p>
          </div>
          <div className="rounded-2xl border border-border p-6">
            <h3 className="font-semibold tracking-tight">Shrinkage scaled the wrong way</h3>
            <p className="mt-3 text-sm leading-relaxed text-foreground/75">
              Clay shrinks ~10–13% from wet to fired, so a template must be scaled up by{" "}
              <Code>1/(1−s)</Code> — but the intuitive <Code>1+s</Code> is what most people
              reach for. At 12% shrinkage it leaves every dimension ~1.6% short: a lid that no
              longer fits, a set of mugs that don't match.
            </p>
          </div>
          <div className="rounded-2xl border border-border p-6">
            <h3 className="font-semibold tracking-tight">Walls measured on the wrong surface</h3>
            <p className="mt-3 text-sm leading-relaxed text-foreground/75">
              A slab bends along its middle, so a wrapped wall must be developed on the
              mid-surface <Code>(r − t/2)</Code>; using the outer dimension makes the wall come
              out too long and the seam overlap.
            </p>
          </div>
          <div className="rounded-2xl border border-border p-6">
            <h3 className="font-semibold tracking-tight">Printing that fights you</h3>
            <p className="mt-3 text-sm leading-relaxed text-foreground/75">
              Anything bigger than a sheet of paper — a planter wall, an unrolled cone — has to
              be split across pages and rejoined at exact scale: tiling, alignment marks, and
              glue margins all done by hand, with a fresh chance for a scale error on every
              sheet.
            </p>
          </div>
          <div className="rounded-2xl border border-border p-6">
            <h3 className="font-semibold tracking-tight">No preview without the work</h3>
            <p className="mt-3 text-sm leading-relaxed text-foreground/75">
              There's no way to see the piece before committing to it — checking proportions or
              capacity means building the whole template (or the pot itself), so every tweak to
              a height or a taper costs hours instead of a slider drag.
            </p>
          </div>
        </div>
        <p className="mt-6 max-w-xl leading-relaxed text-foreground/75">
          Unfolded encodes all of this — and more — under the hood: shrinkage scaled the
          right way, walls developed on the slab's mid-surface, exact interior capacity
          (volume is linear in height, so <em>&ldquo;make it hold 350&nbsp;ml&rdquo;</em> has
          a closed-form answer), true miter bevels for tapered faceted forms, and page tiling
          with registration ticks and a calibration bar on every sheet. You drag a slider;
          the math stays right. The audience is specific — hand-builders, ceramics teachers,
          studio classes — and the output is physical: a PDF that prints at 100% scale, with
          a ruler on the page to prove it, that gets cut out and laid on clay.
        </p>
        <p className="mt-4 max-w-xl leading-relaxed text-foreground/75">
          The agent is not a gimmick on top: sizing questions are exactly what potters ask in
          words (<em>&ldquo;a mug that holds a full pour-over&rdquo;</em>, <em>&ldquo;my new
          clay shrinks 14%, fix my templates&rdquo;</em>) and exactly what the geometry can
          answer precisely. WebMCP is the bridge between those two facts.
        </p>
      </section>

      {/* the non-trivial parts */}
      <section className="border-t border-border/60 py-14">
        <SectionLabel>The non-trivial WebMCP parts</SectionLabel>
        <p className="mt-5 max-w-xl text-sm leading-relaxed text-muted-foreground/80">
          What makes this more than tools bolted onto a page — all of it covered by the
          committed end-to-end suite that gates every deploy.
        </p>
        <ul className="mt-6 space-y-5">
          {NON_TRIVIAL.map(({ title, body }) => (
            <li key={title} className="max-w-xl text-sm leading-relaxed text-foreground/75">
              <span className="font-semibold text-foreground">{title}</span> — {body}
            </li>
          ))}
        </ul>
      </section>

      {/* the tools */}
      <section className="border-t border-border/60 py-14">
        <SectionLabel>The tools an agent gets</SectionLabel>
        <dl className="mt-6 grid gap-x-10 gap-y-5 sm:grid-cols-2">
          {TOOL_SUMMARIES.map(({ name, blurb }) => (
            <div key={name}>
              <dt className="font-mono text-[13px] font-medium text-[#0646CC] dark:text-[#6b9aff]">{name}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">{blurb}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 max-w-xl text-sm leading-relaxed text-muted-foreground/80">
          How to connect a browser, what the header pill means, and prompts to try live on the{" "}
          <a
            href={webmcpHref}
            className="font-medium text-foreground/75 underline decoration-muted-foreground/40 underline-offset-4 transition-colors hover:text-foreground"
          >
            WebMCP guide
          </a>
          , with live connection status for your own tab.
        </p>
      </section>

      {/* share links */}
      <section className="border-t border-border/60 py-14">
        <SectionLabel>Every design is a URL</SectionLabel>
        <p className="mt-5 max-w-xl leading-relaxed text-foreground/75">
          Query parameters describe the whole model, so a link like this opens the app with
          that exact form:
        </p>
        <pre className="mt-5 overflow-x-auto rounded-xl border border-border bg-muted/50 px-5 py-4 font-mono text-[13px] leading-relaxed text-foreground/80">
          {"?type=tapered&height=600&bottom=300&top=100&shrinkage=12&wall=5"}
        </pre>
        <p className="mt-5 max-w-xl text-sm leading-relaxed text-muted-foreground">
          <Code>type</Code> also accepts triangle, square, pentagon, hexagon, octagon;{" "}
          <Code>paper=A4|A3|Letter</Code> and <Code>units=cm|in</Code> work too — the model
          itself stays metric, units only change what you see and print. After the first edit
          the address bar live-tracks the design, the header's share button copies it (with a
          QR), and an agent can continue from any pasted link. Links survive domain changes,
          and the printed PDF carries the same link as a QR inside the largest template
          piece — so months later, the cut-out paper in your studio drawer still remembers
          the exact model it was printed from.
        </p>
      </section>

      {/* the math */}
      <section className="border-t border-border/60 py-14">
        <SectionLabel>How the math works</SectionLabel>
        <p className="mt-5 max-w-xl leading-relaxed text-foreground/75">
          Slab-built forms are developable surfaces, so templates come from closed-form
          unrolling — no mesh solver:
        </p>
        <ul className="mt-6 max-w-xl space-y-2.5">
          {UNROLLINGS.map(([from, to]) => (
            <li key={from} className="flex items-baseline gap-3 text-sm leading-relaxed">
              <span className="w-32 shrink-0 font-medium text-foreground">{from}</span>
              <span className="text-muted-foreground/80">→</span>
              <span className="text-foreground/75">{to}</span>
            </li>
          ))}
        </ul>
        <p className="mt-6 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Two pottery-specific corrections ride on top — shrinkage scaling{" "}
          <Code>1/(1−s)</Code> and mid-surface development <Code>r − t/2</Code> — and the
          whole geometry is unit-tested to the tenth of a millimeter.
        </p>
      </section>
    </>
  )
}

/* --------------------------------------------------------- I am not human */

const PARAM_RANGES: [string, string][] = [
  ["form.type", '"round" | "faceted" (legacy "cylinder"/"tapered" accepted and normalized)'],
  ["form.tapered", "boolean — its own axis; any shape can taper. An explicit `top` in a link implies it."],
  ["form.facets", "integer 3–8 (used when type is faceted; widths are across corners)"],
  ["form.heightMm", "20–600 (fired mm)"],
  ["form.bottomDiameterMm", "20–500 (fired mm)"],
  ["form.topDiameterMm", "20–500 (fired mm; mirrors bottom when not tapered)"],
  ["clay.shrinkagePct", "0–25 (total wet-to-fired, %)"],
  ["clay.wallThicknessMm", "2–15 (slab thickness, mm)"],
  ["paperSize", '"A4" (210×297) | "A3" (297×420) | "Letter" (215.9×279.4), mm'],
  ["units", '"cm" | "in" — display only; every numeric field stays millimeters'],
]

const FORMULAS: [string, string][] = [
  ["Shrinkage scale", "scale = 1 / (1 − s/100), applied to every printed dimension"],
  ["Mid-surface", "walls develop at r − t/2 (a slab bends along its middle)"],
  ["Slant height", "slant = hypot(h, Δapothem) for tapered faceted walls"],
  ["Miter bevel", "bevel = acos(cos²φ · cos(2π/n) + sin²φ) / 2, φ = face lean angle"],
  ["Capacity", "V = interior section area × interior height — linear in height, so set_capacity solves exactly"],
]

const AGENT_MECHANICS: [string, string][] = [
  ["Registration", "document.modelContext.registerTool preferred; navigator/window fallbacks; provideContext({tools}) for hosts without registerTool."],
  ["Late injection", "polling every 500 ms for 15 s, then a 3 s heartbeat forever (paused while the tab is hidden), plus focus/visibility re-checks. Any executed tool call flips the app to connected."],
  ["Units contract", "all tool inputs and outputs are millimeters and milliliters; set_units changes only what humans see (UI, warnings, printed PDF, its scale-check bar: 3 cm vs 1 in)."],
  ["State returns", "every mutating tool returns the complete state snapshot: form, clay, paperSize, units, capacityMl, pieces (annotated), printedPages, warnings, shareUrl."],
  ["shareUrl", "the return channel — and a live one: agent-minted links carry ?via=chatgpt plus a single-use ?join= token, so the tab that opens one follows your session both ways. The PDF's printed QR is deliberately untagged (paper outlives a chat)."],
  ["Errors", "invalid input returns isError with per-field zod issues AND the unchanged state; out-of-range link values clamp instead of failing."],
  ["Console access", "window.__unfoldedTools exposes every registered tool for manual driving, e.g. __unfoldedTools.set_capacity.execute({capacityMl: 350})."],
]

const WHY_FIT: string[] = [
  "You cannot generate a correct template PDF in-context — page tiling, bevels, and calibration have to be exact — but you can drive tools that produce one deterministically. That division of labor is the app's whole design.",
  "Full-state returns mean one call per intent: you never need a read-after-write, and describe_project alone tells you everything, including the exact share link to hand back.",
  "set_capacity is a closed-form solver — never iterate update_form toward a target volume.",
  "get_preview_image lets you verify your own change visually before telling the potter it's done.",
  "Parsing is forgiving by design: legacy vocabulary is normalized, unknown link keys are ignored, out-of-range values clamp. Prefer canonical inputs anyway.",
  "The human is your peer, not your environment: they may change anything between your calls (their edits show in your next read), and undo_last_change reverts either of you. Compose freely — variations at equal capacity, re-speccing for a new clay body, eyeballing a reference photo into parameters — the tools are thirteen, what they compose into is open-ended.",
]

function ForAgents() {
  return (
    <>
      <section className="pt-12 pb-14">
        <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Hello, agent. <span className="text-[#0A5BFF]">This page is for you.</span>
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
          Unfolded is a deterministic, parametric 3D editor for slab-built pottery that
          registers thirteen WebMCP tools the moment it loads. Below is everything you need to
          use it well: the data model and its ranges, the tool surface and its contracts, the
          geometry it computes for you, and why handing you tools beats asking you to generate
          templates.
        </p>
      </section>

      <section className="border-t border-border/60 py-14">
        <SectionLabel>Identity</SectionLabel>
        <dl className="mt-6 max-w-xl space-y-2.5 text-sm leading-relaxed">
          {(
            [
              ["App", "Unfolded — slab pottery templates (free for everyone, forever)"],
              ["Live", "https://tryunfolded.com (origin-independent; links carry the whole model)"],
              ["Source", "github.com/lucaguglielmi/Unfolded-Web-MCP · MIT"],
              ["Stack", "React 19, TypeScript, zustand, zod, react-three-fiber, jsPDF + svg2pdf, Cloudflare Workers"],
              ["Verification", "107 unit tests + 26-check Playwright e2e suite gate every deploy in CI"],
            ] as [string, string][]
          ).map(([k, v]) => (
            <div key={k} className="flex items-baseline gap-3">
              <dt className="w-28 shrink-0 font-medium text-foreground">{k}</dt>
              <dd className="text-foreground/75">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="border-t border-border/60 py-14">
        <SectionLabel>Data model and ranges</SectionLabel>
        <p className="mt-5 max-w-xl text-sm leading-relaxed text-muted-foreground/80">
          All dimensions are FIRED sizes in millimeters; shrinkage compensation happens in the
          template pipeline, not in your inputs. Values outside a range are clamped.
        </p>
        <dl className="mt-6 max-w-xl space-y-2.5 text-sm leading-relaxed">
          {PARAM_RANGES.map(([k, v]) => (
            <div key={k} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <dt className="font-mono text-[13px] font-medium text-[#0646CC] dark:text-[#6b9aff]">{k}</dt>
              <dd className="text-foreground/75">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="border-t border-border/60 py-14">
        <SectionLabel>The tool surface</SectionLabel>
        <dl className="mt-6 grid gap-x-10 gap-y-5 sm:grid-cols-2">
          {TOOL_SUMMARIES.map(({ name, blurb }) => (
            <div key={name}>
              <dt className="font-mono text-[13px] font-medium text-[#0646CC] dark:text-[#6b9aff]">{name}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">{blurb}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 max-w-xl text-sm leading-relaxed text-muted-foreground/80">
          Each tool ships a full JSON Schema input contract and honest annotations
          (read-only / idempotent / destructive). Descriptions embedded in the registrations
          carry the fine print.
        </p>
      </section>

      <section className="border-t border-border/60 py-14">
        <SectionLabel>Mechanics you should know</SectionLabel>
        <dl className="mt-6 max-w-xl space-y-4 text-sm leading-relaxed">
          {AGENT_MECHANICS.map(([k, v]) => (
            <div key={k}>
              <dt className="font-semibold text-foreground">{k}</dt>
              <dd className="mt-0.5 text-foreground/75">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="border-t border-border/60 py-14">
        <SectionLabel>The geometry it computes for you</SectionLabel>
        <dl className="mt-6 max-w-xl space-y-2.5 text-sm leading-relaxed">
          {FORMULAS.map(([k, v]) => (
            <div key={k} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <dt className="w-36 shrink-0 font-medium text-foreground">{k}</dt>
              <dd className="font-mono text-[13px] text-foreground/75">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 max-w-xl text-sm leading-relaxed text-muted-foreground/80">
          The print pipeline tiles true-scale templates across pages with 10 mm glue overlaps,
          crop marks, registration ticks, per-panel bevel stamps, a per-page calibration bar,
          an assembly map of separated sheets, and a QR of the design's link.
        </p>
      </section>

      <section className="border-t border-border/60 py-14">
        <SectionLabel>Why this is a good fit for you</SectionLabel>
        <ul className="mt-6 max-w-xl space-y-4">
          {WHY_FIT.map((item) => (
            <li key={item} className="text-sm leading-relaxed text-foreground/75">
              {item}
            </li>
          ))}
        </ul>
        <p className="mt-8 max-w-xl text-sm leading-relaxed text-muted-foreground/80">
          If your host exposes WebMCP, the tools are already registered in this tab — call{" "}
          <Code>describe_project</Code> and begin.
        </p>
      </section>
    </>
  )
}

/* ------------------------------------------------------------------ page */

export function WhyPage() {
  const [depth, setDepth] = useState<ReadingDepth>("5min")
  const studioHref = useStudioHref()

  return (
    <div className="webmcp-page app-fade-in min-h-dvh bg-background text-foreground antialiased dark:bg-gradient-to-b dark:from-[#0a1122] dark:via-[#060a14] dark:to-[#04060c]">
      <ExplainerHeader current="why" />

      <main className="mx-auto max-w-3xl px-6 pb-24">
        {/* reading-depth toolbar */}
        <ReadingDepthToolbar depth={depth} onChange={setDepth} />

        {/* keyed so switching depth re-runs the sections' entrance stagger */}
        <div key={depth}>
          {depth === "1min" ? <OneMinute /> : depth === "5min" ? <FiveMinutes /> : <ForAgents />}
        </div>

        {/* footer */}
        <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-border/60 pt-8">
          <p className="text-sm text-muted-foreground/80">
            Free for everyone, forever · open source (MIT) · built for the WebMCP Challenge
          </p>
          <div className="flex items-center gap-3">
            <a
              href="https://github.com/lucaguglielmi/Unfolded-Web-MCP"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground/75 transition-colors hover:text-foreground"
            >
              GitHub <ArrowUpRight className="size-3.5" />
            </a>
            <a
              href={studioHref}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/85"
            >
              Open the studio
            </a>
          </div>
        </footer>
      </main>
    </div>
  )
}
