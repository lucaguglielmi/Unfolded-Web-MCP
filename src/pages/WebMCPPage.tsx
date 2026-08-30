import { ArrowLeft, ArrowUpRight } from "lucide-react"
import { LogoMark } from "@/components/LogoMark"
import { cn } from "@/lib/utils"
import { useProjectStore } from "@/store/useProjectStore"

/**
 * /webmcp — the page the header's WebMCP pill links to. A quiet, white,
 * typographic explainer: what WebMCP is, how to turn it on, and everything
 * an agent can do in this app. Shows the live connection status of THIS
 * browser (the same tools register here too).
 */

const TOOLS: [string, string][] = [
  ["describe_project", "Read the whole design: form, clay, template pieces, capacity in ml, and its share link."],
  ["update_form", "Change shape, facets, height and diameters — fired sizes, in millimeters."],
  ["set_clay", "Set shrinkage % and slab thickness for the potter's clay body."],
  ["get_template_summary", "Template layout, per-piece dimensions, and the exact PDF page count."],
  ["get_preview_image", "See the live 3D preview as an image — exactly what the potter sees."],
  ["export_templates", "Generate and download the true-scale, multi-page template PDF."],
  ["open_model", "Open a design from a pasted share link and keep editing it."],
  ["apply_preset", "Start from a classic mug, tumbler, bud vase, or hex planter."],
  ["undo_last_change", "Revert the last change — the agent's or the potter's."],
]

const PROMPTS = [
  "What am I designing right now?",
  "Make it a hexagonal planter, 18 cm tall and 14 cm wide.",
  "My stoneware shrinks 13% — adjust and tell me the fired sizes.",
  "Make it hold about 350 ml, show me how it looks, then export the PDF.",
]

function StatusPill() {
  const active = useProjectStore((s) => s.agentStatus) === "native"
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium",
        active
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-stone-200 bg-stone-50 text-stone-500"
      )}
    >
      <span className="relative flex size-2">
        {active && (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        )}
        <span
          className={cn(
            "relative inline-flex size-2 rounded-full",
            active ? "bg-emerald-500" : "bg-stone-300"
          )}
        />
      </span>
      {active
        ? "WebMCP is active in this browser — your agent is connected"
        : "WebMCP is not active in this browser yet"}
    </span>
  )
}

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="text-xs font-medium tracking-[0.18em] text-stone-400 uppercase">{children}</p>
  )
}

export function WebMCPPage() {
  return (
    <div className="min-h-dvh bg-white text-stone-900 antialiased">
      {/* top bar */}
      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
        <a href="/" className="flex items-center gap-2.5">
          <LogoMark className="h-5 w-auto" />
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
          <StatusPill />
          <h1 className="mt-6 max-w-xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Your AI agent can use this app <span className="text-[#0A5BFF]">with you</span>.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-stone-500">
            Unfolded is WebMCP&#8209;native. Open it in an agent&#8209;capable browser and the AI
            you're chatting with can see your pottery design, change it, check its capacity,
            and export the printable templates — live, in the same session you're looking at.
          </p>
        </section>

        {/* what is webmcp */}
        <section className="border-t border-stone-100 py-14">
          <SectionLabel>What is WebMCP?</SectionLabel>
          <p className="mt-5 max-w-xl leading-relaxed text-stone-600">
            WebMCP is a browser API that lets a web page hand real, typed tools to the AI agent
            browsing alongside you. Instead of the agent guessing at pixels or filling forms, the
            page says: <em>here is exactly what you can do</em>. This app registers nine tools on{" "}
            <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[0.85em] text-stone-700">
              document.modelContext
            </code>{" "}
            the moment it loads. You and your agent then edit the same design — your slider drags
            show up in its next read, its changes animate in your 3D preview, and either of you
            can undo the other.
          </p>
        </section>

        {/* how to turn it on */}
        <section className="border-t border-stone-100 py-14">
          <SectionLabel>Try it in two ways</SectionLabel>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-stone-200 p-6">
              <h3 className="font-semibold tracking-tight">ChatGPT's in-app browser</h3>
              <p className="mt-1 text-sm text-stone-400">WebMCP works out of the box.</p>
              <ol className="mt-4 space-y-2.5 text-sm leading-relaxed text-stone-600">
                <li>1. In the ChatGPT app, open this site in the built-in browser.</li>
                <li>2. Watch the WebMCP pill in the header turn green.</li>
                <li>3. Ask for the pot you want — the design changes as you chat.</li>
              </ol>
            </div>
            <div className="rounded-2xl border border-stone-200 p-6">
              <h3 className="font-semibold tracking-tight">Google Chrome</h3>
              <p className="mt-1 text-sm text-stone-400">Behind an experimental flag.</p>
              <ol className="mt-4 space-y-2.5 text-sm leading-relaxed text-stone-600">
                <li>
                  1. Open{" "}
                  <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[0.8rem] break-all text-stone-700">
                    chrome://flags/#enable-webmcp-testing
                  </code>
                </li>
                <li>2. Enable it and relaunch Chrome.</li>
                <li>3. Come back here with an agent that speaks WebMCP.</li>
              </ol>
            </div>
          </div>
          <p className="mt-4 text-sm text-stone-400">
            The pill in the studio header shows a{" "}
            <span className="font-medium text-emerald-600">pulsing green dot</span> whenever the
            tools are registered and an agent can reach them.
          </p>
        </section>

        {/* the tools */}
        <section className="border-t border-stone-100 py-14">
          <SectionLabel>What your agent can do</SectionLabel>
          <dl className="mt-6 grid gap-x-10 gap-y-5 sm:grid-cols-2">
            {TOOLS.map(([name, description]) => (
              <div key={name}>
                <dt className="font-mono text-[13px] font-medium text-[#0646CC]">{name}</dt>
                <dd className="mt-1 text-sm leading-relaxed text-stone-500">{description}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* prompts */}
        <section className="border-t border-stone-100 py-14">
          <SectionLabel>Things to say</SectionLabel>
          <ul className="mt-6 space-y-3">
            {PROMPTS.map((prompt) => (
              <li
                key={prompt}
                className="rounded-xl border border-stone-200 bg-stone-50/60 px-5 py-3.5 text-[15px] text-stone-700"
              >
                “{prompt}”
              </li>
            ))}
          </ul>
          <p className="mt-5 max-w-xl text-sm leading-relaxed text-stone-400">
            Every change the agent makes is validated by the same rules as the sliders, every
            response includes a share link that reopens the exact design, and templates are always
            shrinkage-compensated for your clay. If the agent takes a wrong turn — undo is one tap.
          </p>
        </section>

        {/* footer */}
        <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-stone-100 pt-8">
          <p className="text-sm text-stone-400">
            Open source (MIT) · built for the WebMCP Challenge
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
