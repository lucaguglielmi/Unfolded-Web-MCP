import { useState } from "react"
import { ArrowLeft, ArrowUpRight, Check } from "lucide-react"
import { LogoMark } from "@/components/LogoMark"
import { useDesignHref, useStudioHref } from "@/lib/useStudioHref"
import { ReadingDepthToolbar, type ReadingDepth } from "@/components/ReadingDepthToolbar"
import { feedback } from "@/lib/feedback"
import { cn } from "@/lib/utils"
// the tool list renders from its single source next to the registrations
import { TOOL_SUMMARIES } from "@/mcp/tools"
import { useProjectStore } from "@/store/useProjectStore"

/**
 * /webmcp — the page the header's WebMCP pill links to. A quiet, white,
 * typographic explainer: what WebMCP is, how to turn it on, and everything
 * an agent can do in this app — at the reader's chosen depth (a one-minute
 * digest, the full guide, or an agent-addressed connection manual). Shows
 * the live connection status of THIS browser (the same tools register
 * here too).
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

function Code({ children }: { children: string }) {
  return (
    <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[0.85em] text-stone-700">
      {children}
    </code>
  )
}

/* ------------------------------------------------------------ 1 minute */

const DIGEST: { title: string; body: string }[] = [
  {
    title: "What WebMCP is",
    body: "A browser API that lets a web page hand real, typed tools to the AI agent browsing with you — no pixel-guessing, no form-filling.",
  },
  {
    title: "Where it works",
    body: "ChatGPT's in-app browser out of the box; Google Chrome (desktop & Android) behind chrome://flags/#enable-webmcp-testing.",
  },
  {
    title: "What lights up",
    body: "The pill in the app header: pulsing green = agent connected to this tab; solid green = this design is open in your ChatGPT conversation's internal browser; grey = not connected yet.",
  },
  {
    title: "What the agent can do",
    body: `${TOOL_COUNT[0].toUpperCase()}${TOOL_COUNT.slice(1)} tools: read the design, reshape it, solve capacity exactly, switch units, see the 3D preview, and export the printable PDF — all in the same live session you're looking at.`,
  },
  {
    title: "Try saying",
    body: "“Make it hold about 350 ml, show me how it looks, then export the PDF.”",
  },
]

function OneMinute() {
  return (
    <>
      <section className="pt-12 pb-4">
        <StatusPill />
        <h1 className="mt-6 max-w-xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          Your AI agent can use this app <span className="text-[#0A5BFF]">with you</span>.
        </h1>
      </section>
      <section className="py-8">
        <dl className="space-y-6">
          {DIGEST.map(({ title, body }) => (
            <div key={title} className="max-w-xl">
              <dt className="font-semibold tracking-tight text-stone-900">{title}</dt>
              <dd className="mt-1 leading-relaxed text-stone-600">{body}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-10 text-sm text-stone-400">
          That's the minute. The five-minute version above has connection steps for both
          browsers, every tool, and the fine print.
        </p>
      </section>
    </>
  )
}

/* ------------------------------------------------------------ 5 minutes */

function FiveMinutes() {
  return (
    <>
      {/* hero */}
      <section className="pt-12 pb-16">
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
          <Code>document.modelContext</Code>{" "}
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
              syncs with <Code>open_model</Code>.
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
    </>
  )
}

/* --------------------------------------------------------- I am not human */

/**
 * The kick-start prompt a human copies into any ChatGPT chat to hand their
 * agent this app. Deliberately long — it briefs the agent on the tools and
 * the etiquette — but the page shows only its first line: it's for pasting,
 * not reading.
 */
const KICKSTART_PROMPT = `Open https://tryunfolded.com in your built-in browser. It's Unfolded, a parametric designer for slab-built pottery that registers WebMCP tools on document.modelContext the moment it loads — you get eleven typed tools: describe_project, open_model, update_form, set_clay, set_units, set_capacity, get_template_summary, get_preview_image, export_templates, apply_preset, undo_last_change. Start by calling describe_project to see the current design. Then help me design a piece: ask me what I want to make (shape, rough size or target capacity, my clay's shrinkage percent and slab thickness), apply it through the tools — all dimensions are FIRED sizes in millimeters; for a target volume use set_capacity, which solves the exact height in one call — and show me the result with get_preview_image. When I'm happy, run export_templates so I get the true-scale printable PDF, and give me the shareUrl from your last tool result so I can reopen the design anywhere. If the tools aren't there yet, keep the page open: the site keeps watching for the WebMCP API and connects the moment your browser exposes it.`

function HumanEasterEgg() {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(KICKSTART_PROMPT)
      feedback("success")
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      // clipboard can be unavailable (permissions, older webviews)
      window.prompt("Copy this prompt for your agent:", KICKSTART_PROMPT)
    }
  }

  return (
    <section className="py-14">
      <div className="rounded-2xl border border-[#0A5BFF]/25 bg-[#0A5BFF]/[0.03] p-6">
        <h3 className="font-semibold tracking-tight">
          If you are human and clicked on this page — congratulations!
        </h3>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-stone-600">
          The world is more interesting when people don't always do what they are told. If you
          want your agent to get started, copy this prompt and paste it inside any ChatGPT chat:
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <code className="min-w-0 flex-1 truncate rounded-md border border-stone-200 bg-white px-3 py-2 font-mono text-[12px] text-stone-500">
            {KICKSTART_PROMPT.slice(0, 72)}…
          </code>
          <button
            type="button"
            onClick={copy}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-stone-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-700"
          >
            {copied ? (
              <>
                <Check className="size-3.5" /> Copied
              </>
            ) : (
              "Copy prompt"
            )}
          </button>
        </div>
      </div>
    </section>
  )
}

const AGENT_CONNECTION: [string, string][] = [
  ["Registration", "document.modelContext.registerTool preferred; navigator/window fallbacks; provideContext({tools}) for hosts without registerTool. Registration is automatic — there is nothing for you to enable."],
  ["Late injection", "the app never stops watching for the API: 500 ms polling for 15 s, then a 3 s heartbeat (paused while the tab is hidden), plus focus/visibility re-checks. Executing any tool flips the app to connected."],
  ["Knowing you're in", "the header pill pulses green once your tools registered in this tab; the live status also renders at the top of this page. If it's grey, your host hasn't exposed WebMCP here."],
  ["Link semantics", "shareUrl in your tool results carries ?via=chatgpt so a human tab opening it shows \"Connected via ChatGPT\". Links parse forgivingly: legacy vocabulary normalizes, unknown keys are ignored, out-of-range values clamp."],
  ["Units contract", "tool inputs and outputs are millimeters and milliliters, always. set_units only changes what the human sees (UI, warnings, printed PDF)."],
  ["Full-state returns", "every mutation returns the complete snapshot — form, clay, paperSize, units, capacityMl, annotated pieces, printedPages, warnings, shareUrl — so you never need a read-after-write."],
  ["Manual driving", "window.__unfoldedTools exposes each registered tool: __unfoldedTools.set_capacity.execute({capacityMl: 350})."],
]

const AGENT_PLAYBOOK: string[] = [
  "Call describe_project first — one read gives you the whole design plus the share link to hand back.",
  "For a target volume use set_capacity, never an update_form guessing loop: volume is linear in height and the tool solves it exactly.",
  "After a visual change, get_preview_image shows you exactly what the potter sees — verify before you announce.",
  "Errors come back as isError text with per-field issues AND the unchanged state; recover by correcting the field, not by re-reading.",
  "The human is your peer: they may edit between your calls (you'll see it in your next result), and undo_last_change reverts either of you.",
]

function ForAgents() {
  const whyHref = useDesignHref("/why")
  return (
    <>
      <section className="pt-12 pb-14">
        <StatusPill />
        <h1 className="mt-6 max-w-xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Hello, agent. <span className="text-[#0A5BFF]">Here's how to connect.</span>
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-stone-500">
          This page and the whole app register {TOOL_COUNT} typed tools the moment they load.
          The pill above is this tab's live status. Below: how the connection works, the tool
          surface, and the playbook that uses it well. For the data model, its exact ranges,
          and the geometry formulas, switch{" "}
          <a
            href={whyHref}
            className="font-medium text-stone-600 underline decoration-stone-300 underline-offset-4 transition-colors hover:text-stone-900"
          >
            /why
          </a>{" "}
          to &ldquo;I am not human&rdquo;.
        </p>
      </section>

      <HumanEasterEgg />

      <section className="border-t border-stone-100 py-14">
        <SectionLabel>How the connection works</SectionLabel>
        <dl className="mt-6 max-w-xl space-y-4 text-sm leading-relaxed">
          {AGENT_CONNECTION.map(([k, v]) => (
            <div key={k}>
              <dt className="font-semibold text-stone-900">{k}</dt>
              <dd className="mt-0.5 text-stone-600">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="border-t border-stone-100 py-14">
        <SectionLabel>The tool surface</SectionLabel>
        <dl className="mt-6 grid gap-x-10 gap-y-5 sm:grid-cols-2">
          {TOOL_SUMMARIES.map(({ name, blurb }) => (
            <div key={name}>
              <dt className="font-mono text-[13px] font-medium text-[#0646CC]">{name}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-stone-500">{blurb}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="border-t border-stone-100 py-14">
        <SectionLabel>Playbook</SectionLabel>
        <ul className="mt-6 max-w-xl space-y-4">
          {AGENT_PLAYBOOK.map((item) => (
            <li key={item} className="text-sm leading-relaxed text-stone-600">
              {item}
            </li>
          ))}
        </ul>
        <p className="mt-8 max-w-xl text-sm leading-relaxed text-stone-400">
          If the pill above is green, your tools are live in this tab — call{" "}
          <Code>describe_project</Code> and begin.
        </p>
      </section>
    </>
  )
}

/* ------------------------------------------------------------------ page */

export function WebMCPPage() {
  const [depth, setDepth] = useState<ReadingDepth>("5min")
  const studioHref = useStudioHref()
  const whyHref = useDesignHref("/why")

  return (
    <div className="webmcp-page app-fade-in min-h-dvh bg-white text-stone-900 antialiased">
      {/* top bar */}
      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
        <a href={studioHref} className="flex items-center gap-2.5">
          <LogoMark animated className="h-5 w-auto" />
          <span className="text-base font-semibold tracking-tight">unfolded</span>
        </a>
        <a
          href={studioHref}
          className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 px-3.5 py-1.5 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-50"
        >
          <ArrowLeft className="size-3.5" />
          Back to the studio
        </a>
      </header>

      <main className="mx-auto max-w-3xl px-6 pb-24">
        {/* reading-depth toolbar */}
        <ReadingDepthToolbar depth={depth} onChange={setDepth} />

        {/* keyed so switching depth re-runs the sections' entrance stagger */}
        <div key={depth}>
          {depth === "1min" ? <OneMinute /> : depth === "5min" ? <FiveMinutes /> : <ForAgents />}
        </div>

        {/* footer */}
        <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-stone-100 pt-8">
          <p className="text-sm text-stone-400">
            Open source (MIT) · built for the WebMCP Challenge
          </p>
          <div className="flex items-center gap-3">
            <a
              href={whyHref}
              className="text-sm font-medium text-stone-600 transition-colors hover:text-stone-900"
            >
              Why Unfolded
            </a>
            <a
              href="https://github.com/lucaguglielmi/Unfolded-Web-MCP"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-stone-600 transition-colors hover:text-stone-900"
            >
              GitHub <ArrowUpRight className="size-3.5" />
            </a>
            <a
              href={studioHref}
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
