import { ArrowLeft, ArrowUpRight } from "lucide-react"
import { LogoMark } from "@/components/LogoMark"
// the tool list renders from its single source next to the registrations
import { TOOL_SUMMARIES } from "@/mcp/tools"

/**
 * /why — the README, told as a page: why Unfolded exists, what makes its
 * WebMCP integration non-trivial, how the math works, and how designs
 * travel as links. Same quiet, white, typographic language as /webmcp.
 */

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="text-xs font-medium tracking-[0.18em] text-stone-400 uppercase">{children}</p>
  )
}

const NON_TRIVIAL: { title: string; body: string }[] = [
  {
    title: "Eleven tools with real contracts",
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
]

const UNROLLINGS = [
  ["Cylinder", "rectangle"],
  ["Cone frustum", "annular sector"],
  ["Prism", "flat panels"],
  ["Tapered prism", "trapezoid panels, miter bevel recomputed for the lean"],
]

export function WhyPage() {
  return (
    <div className="webmcp-page app-fade-in min-h-dvh bg-white text-stone-900 antialiased">
      {/* top bar */}
      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
        <a href="/" className="flex items-center gap-2.5">
          <LogoMark animated className="h-5 w-auto" />
          <span className="text-base font-semibold tracking-tight">unfolded</span>
        </a>
        <a
          href="/"
          className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 px-3.5 py-1.5 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-50"
        >
          <ArrowLeft className="size-3.5" />
          Back to the studio
        </a>
      </header>

      <main className="mx-auto max-w-3xl px-6 pb-24">
        {/* hero */}
        <section className="pt-14 pb-16 sm:pt-20">
          <SectionLabel>Why Unfolded</SectionLabel>
          <h1 className="mt-6 max-w-xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Design in 3D, <span className="text-[#0A5BFF]">print flat</span>, build in clay.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-stone-500">
            Unfolded lets potters design slab-built forms — mugs, tumblers, vases, planters — as
            parametric 3D objects and turns them into true-scale printable templates to cut,
            tape, and lay on a clay slab. Every dimension is shrinkage-compensated for your clay
            body and developed along the slab mid-surface, so the fired piece matches the design.
          </p>
          <p className="mt-4 max-w-xl leading-relaxed text-stone-500">
            And the whole app is WebMCP-native: an AI agent browsing alongside you can inspect
            and edit the same design you see on screen — <em>&ldquo;make it a 350&nbsp;ml
            tumbler and use my stoneware at 12% shrinkage&rdquo;</em> — while the 3D preview and
            templates update live.
          </p>
        </section>

        {/* why this exists */}
        <section className="border-t border-stone-100 py-14">
          <SectionLabel>Why this exists</SectionLabel>
          <p className="mt-5 max-w-xl leading-relaxed text-stone-600">
            Slab building is the most common hand-building technique in ceramics, and its paper
            step is still manual: potters draw templates on cereal boxes, wrap paper around
            forms, and do the sizing math by hand. Two errors are endemic to that math — and both
            ruin pieces only <em>after</em> the firing:
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-stone-200 p-6">
              <h3 className="font-semibold tracking-tight">Shrinkage scaled the wrong way</h3>
              <p className="mt-3 text-sm leading-relaxed text-stone-600">
                Clay shrinks ~10–13% from wet to fired, so a template must be scaled up by{" "}
                <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[0.85em] text-stone-700">
                  1/(1−s)
                </code>{" "}
                — but the intuitive{" "}
                <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[0.85em] text-stone-700">
                  1+s
                </code>{" "}
                is what most people reach for. At 12% shrinkage it leaves every dimension ~1.6%
                short: a lid that no longer fits, a set of mugs that don't match.
              </p>
            </div>
            <div className="rounded-2xl border border-stone-200 p-6">
              <h3 className="font-semibold tracking-tight">Walls measured on the wrong surface</h3>
              <p className="mt-3 text-sm leading-relaxed text-stone-600">
                A slab bends along its middle, so a wrapped wall must be developed on the
                mid-surface{" "}
                <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[0.85em] text-stone-700">
                  (r − t/2)
                </code>
                ; using the outer dimension makes the wall come out too long and the seam
                overlap.
              </p>
            </div>
          </div>
          <p className="mt-6 max-w-xl leading-relaxed text-stone-600">
            Unfolded encodes both corrections and adds the math no one does by hand at all:
            exact interior capacity (volume is linear in height, so <em>&ldquo;make it hold
            350&nbsp;ml&rdquo;</em> has a closed-form answer) and true miter bevels for tapered
            faceted forms. The audience is specific — hand-builders, ceramics teachers, studio
            classes — and the output is physical: a PDF that prints at 100% scale, with a
            calibration ruler to prove it, that gets cut out and laid on clay.
          </p>
          <p className="mt-4 max-w-xl leading-relaxed text-stone-600">
            The agent is not a gimmick on top: sizing questions are exactly what potters ask in
            words (<em>&ldquo;a mug that holds a full pour-over&rdquo;</em>, <em>&ldquo;my new
            clay shrinks 14%, fix my templates&rdquo;</em>) and exactly what the geometry can
            answer precisely. WebMCP is the bridge between those two facts.
          </p>
        </section>

        {/* the non-trivial parts */}
        <section className="border-t border-stone-100 py-14">
          <SectionLabel>The non-trivial WebMCP parts</SectionLabel>
          <p className="mt-5 max-w-xl text-sm leading-relaxed text-stone-400">
            What makes this more than tools bolted onto a page — all of it covered by the
            committed end-to-end suite that gates every deploy.
          </p>
          <ul className="mt-6 space-y-5">
            {NON_TRIVIAL.map(({ title, body }) => (
              <li key={title} className="max-w-xl text-sm leading-relaxed text-stone-600">
                <span className="font-semibold text-stone-900">{title}</span> — {body}
              </li>
            ))}
          </ul>
        </section>

        {/* the tools */}
        <section className="border-t border-stone-100 py-14">
          <SectionLabel>The tools an agent gets</SectionLabel>
          <dl className="mt-6 grid gap-x-10 gap-y-5 sm:grid-cols-2">
            {TOOL_SUMMARIES.map(({ name, blurb }) => (
              <div key={name}>
                <dt className="font-mono text-[13px] font-medium text-[#0646CC]">{name}</dt>
                <dd className="mt-1 text-sm leading-relaxed text-stone-500">{blurb}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-6 max-w-xl text-sm leading-relaxed text-stone-400">
            How to connect a browser, what the header pill means, and prompts to try live on the{" "}
            <a href="/webmcp" className="font-medium text-stone-600 underline decoration-stone-300 underline-offset-4 transition-colors hover:text-stone-900">
              WebMCP guide
            </a>
            , with live connection status for your own tab.
          </p>
        </section>

        {/* share links */}
        <section className="border-t border-stone-100 py-14">
          <SectionLabel>Every design is a URL</SectionLabel>
          <p className="mt-5 max-w-xl leading-relaxed text-stone-600">
            Query parameters describe the whole model, so a link like this opens the app with
            that exact form:
          </p>
          <pre className="mt-5 overflow-x-auto rounded-xl border border-stone-200 bg-stone-50/60 px-5 py-4 font-mono text-[13px] leading-relaxed text-stone-700">
            {"?type=tapered&height=600&bottom=300&top=100&shrinkage=12&wall=5"}
          </pre>
          <p className="mt-5 max-w-xl text-sm leading-relaxed text-stone-500">
            <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[0.85em] text-stone-700">type</code>{" "}
            also accepts triangle, square, pentagon, hexagon;{" "}
            <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[0.85em] text-stone-700">paper=A4|A3|Letter</code>{" "}
            and{" "}
            <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[0.85em] text-stone-700">units=cm|in</code>{" "}
            work too — the model itself stays metric, units only set how measurements are shown
            and printed. After the first edit the address bar live-tracks the design, the
            header's share button copies it (with a QR), and an agent can continue from any
            pasted link. Links are origin-independent — they survive domain changes — and the
            printed PDF carries a QR of the same link: the paper remembers the model.
          </p>
        </section>

        {/* the math */}
        <section className="border-t border-stone-100 py-14">
          <SectionLabel>How the math works</SectionLabel>
          <p className="mt-5 max-w-xl leading-relaxed text-stone-600">
            Slab-built forms are developable surfaces, so templates come from closed-form
            unrolling — no mesh solver:
          </p>
          <ul className="mt-6 max-w-xl space-y-2.5">
            {UNROLLINGS.map(([from, to]) => (
              <li key={from} className="flex items-baseline gap-3 text-sm leading-relaxed">
                <span className="w-32 shrink-0 font-medium text-stone-900">{from}</span>
                <span className="text-stone-400">→</span>
                <span className="text-stone-600">{to}</span>
              </li>
            ))}
          </ul>
          <p className="mt-6 max-w-xl text-sm leading-relaxed text-stone-500">
            Two pottery-specific corrections are applied on top — clay shrinkage scaling{" "}
            <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[0.85em] text-stone-700">
              1/(1−s)
            </code>{" "}
            and mid-surface development{" "}
            <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[0.85em] text-stone-700">
              r − t/2
            </code>
            . The geometry is unit-tested to the tenth of a millimeter.
          </p>
        </section>

        {/* footer */}
        <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-stone-100 pt-8">
          <p className="text-sm text-stone-400">
            Free for everyone, forever · open source (MIT) · built for the WebMCP Challenge
          </p>
          <div className="flex items-center gap-3">
            <a
              href="https://github.com/lucaguglielmi/Unfolded-Web-MCP"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-stone-600 transition-colors hover:text-stone-900"
            >
              GitHub <ArrowUpRight className="size-3.5" />
            </a>
            <a
              href="/"
              className="inline-flex items-center gap-1.5 rounded-full bg-stone-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-700"
            >
              Open the studio
            </a>
          </div>
        </footer>
      </main>
    </div>
  )
}
