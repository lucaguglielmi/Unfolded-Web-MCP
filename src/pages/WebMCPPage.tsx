import { ArrowLeft, ArrowUpRight } from "lucide-react"
import { LogoMark } from "@/components/LogoMark"
import { cn } from "@/lib/utils"
// the tool list renders from its single source next to the registrations
import { TOOL_SUMMARIES } from "@/mcp/tools"
import { useProjectStore } from "@/store/useProjectStore"

/**
 * /webmcp — the page the header's WebMCP pill links to. A quiet, white,
 * typographic explainer: what WebMCP is, how to turn it on, and everything
 * an agent can do in this app. Shows the live connection status of THIS
 * browser (the same tools register here too).
 */

const COUNT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen"]
const TOOL_COUNT = COUNT_WORDS[TOOL_SUMMARIES.length] ?? String(TOOL_SUMMARIES.length)

const PROMPTS = [
  "What am I designing right now?",
  "Make it a hexagonal planter, 18 cm tall and 14 cm wide.",
  "My stoneware shrinks 13% — adjust and tell me the fired sizes.",
  "Make it hold about 350 ml, show me how it looks, then export the PDF.",
]

function StatusPill() {
  const status = useProjectStore((s) => s.agentStatus)
  const location = useProjectStore((s) => s.agentApiLocation)
  const green = status !== "unavailable"
  const text =
    status === "native"
      ? `WebMCP is active${location ? ` via ${location}` : ""} — your agent is connected to this very tab`
      : status === "chatgpt"
        ? "This design is connected through the internal browser of your ChatGPT conversation — this tab itself has no direct WebMCP"
        : "WebMCP is not active in this browser tab yet — it lights up the moment a host injects the API or an agent calls a tool"
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium",
        green
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-stone-200 bg-stone-50 text-stone-500"
      )}
    >
      <span className="relative flex size-2">
        {status === "native" && (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        )}
        <span
          className={cn(
            "relative inline-flex size-2 rounded-full",
            green ? "bg-emerald-500" : "bg-stone-300"
          )}
        />
      </span>
      {text}
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
            page says: <em>here is exactly what you can do</em>. This app registers {TOOL_COUNT} tools on{" "}
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
              <p className="mt-3 text-xs leading-relaxed text-stone-400">
                Heads up: tapping a link in the chat opens ChatGPT's <em>ordinary</em> in-app
                browser — a separate tab without WebMCP. That tab shows
                &ldquo;Connected via ChatGPT&rdquo; when the agent gave you the link; the
                agent keeps editing in its own internal browser.
              </p>
            </div>
            <div className="rounded-2xl border border-stone-200 p-6">
              <h3 className="font-semibold tracking-tight">Google Chrome (desktop &amp; Android)</h3>
              <p className="mt-1 text-sm text-stone-400">Behind an experimental flag.</p>
              <ol className="mt-4 space-y-2.5 text-sm leading-relaxed text-stone-600">
                <li>
                  1. Open{" "}
                  <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[0.8rem] break-all text-stone-700">
                    chrome://flags/#enable-webmcp-testing
                  </code>{" "}
                  (on Android too; if it's missing, try Chrome Canary).
                </li>
                <li>2. Enable it and relaunch Chrome — the pill here turns green.</li>
                <li>
                  3. No agent attached? Drive the tools yourself from the DevTools console
                  (desktop, or via <code className="rounded bg-stone-100 px-1 py-0.5 font-mono text-[0.8rem] text-stone-700">chrome://inspect</code> for
                  a phone):{" "}
                  <code className="rounded bg-stone-100 px-1 py-0.5 font-mono text-[0.8rem] break-all text-stone-700">
                    __unfoldedTools.set_capacity.execute({"{"}capacityMl: 350{"}"})
                  </code>
                </li>
              </ol>
            </div>
          </div>
        </section>

        {/* the three pill states */}
        <section className="border-t border-stone-100 py-14">
          <SectionLabel>What the pill in the header means</SectionLabel>
          <ul className="mt-6 space-y-4">
            <li className="flex items-start gap-3">
              <span className="relative mt-1 flex size-2 shrink-0">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
              </span>
              <p className="text-sm leading-relaxed text-stone-600">
                <span className="font-semibold text-stone-900">WebMCP active</span> — the API is
                available in this very tab and the tools registered. You and the agent share one
                live session: every change either of you makes is visible to both.
              </p>
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-1 inline-flex size-2 shrink-0 rounded-full bg-emerald-500" />
              <p className="text-sm leading-relaxed text-stone-600">
                <span className="font-semibold text-stone-900">Connected via ChatGPT</span> — this
                tab has no direct WebMCP, but the design arrived through a link the agent minted,
                so it is open in the internal browser of your ChatGPT conversation. Edits made
                here aren't automatically shared — send your link back to the chat and the agent
                syncs with <code className="rounded bg-stone-100 px-1 py-0.5 font-mono text-[0.8rem] text-stone-700">open_model</code>.
              </p>
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-1 inline-flex size-2 shrink-0 rounded-full bg-stone-300" />
              <p className="text-sm leading-relaxed text-stone-600">
                <span className="font-semibold text-stone-900">WebMCP</span> with a grey dot —
                neither could be confirmed in this tab. Ask ChatGPT to open Unfolded in its
                internal browser, or enable the Chrome flag above.
              </p>
            </li>
          </ul>
          <p className="mt-5 text-sm text-stone-400">
            The states are honest by design: a ChatGPT connection is only ever shown on the
            explicit signal of an agent-minted link — never guessed from your browser's user
            agent or from being inside an in-app browser.
          </p>
        </section>

        {/* the tools */}
        <section className="border-t border-stone-100 py-14">
          <SectionLabel>What your agent can do</SectionLabel>
          <dl className="mt-6 grid gap-x-10 gap-y-5 sm:grid-cols-2">
            {TOOL_SUMMARIES.map(({ name, blurb }) => (
              <div key={name}>
                <dt className="font-mono text-[13px] font-medium text-[#0646CC]">{name}</dt>
                <dd className="mt-1 text-sm leading-relaxed text-stone-500">{blurb}</dd>
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
