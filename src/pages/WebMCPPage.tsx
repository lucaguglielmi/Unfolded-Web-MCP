import { useMemo, useState, useSyncExternalStore } from "react"
import { ArrowUpRight, Check } from "lucide-react"
import { isRealChrome } from "@/components/ChromeFlagNudge"
import { ExplainerHeader } from "@/components/ExplainerHeader"
import { useDesignHref } from "@/lib/useStudioHref"
import { StudioCtaBar } from "@/components/StudioCtaBar"
import { ReadingDepthToolbar, type ReadingDepth } from "@/components/ReadingDepthToolbar"
import { feedback } from "@/lib/feedback"
import { useTimeout } from "@/lib/useTimeout"
import { cn } from "@/lib/utils"
// the tool list renders from its single source next to the registrations
import { TOOL_RESULT_CONTRACT } from "@/mcp/modelContext"
import { TOOL_SUMMARIES } from "@/mcp/tools"
import { buildAgentManifest } from "./agentManifest"
import { liveSync } from "@/store/syncClient"
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
  "Join my desktop session, code K7F-3QP.",
  "Send me your latest link — I want to watch this live on my screen.",
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
          ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-400/25 dark:bg-emerald-500/10 dark:text-emerald-300"
          : "border-border bg-muted/50 text-muted-foreground"
      )}
    >
      <span className="relative flex size-2">
        {status === "native" && (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        )}
        <span
          className={cn(
            "relative inline-flex size-2 rounded-full",
            green ? "bg-emerald-500" : "bg-muted-foreground/40"
          )}
        />
      </span>
      {text}
    </span>
  )
}

function LiveSyncStatus() {
  const snapshot = useSyncExternalStore(
    (cb) => liveSync.subscribe(cb),
    () => `${liveSync.status()}:${liveSync.peers()}:${liveSync.everPeered()}`
  )
  const [status, peers, everPeered] = snapshot.split(":")
  const text =
    status === "off"
      ? "This tab is not paired to a live session."
      : everPeered !== "true"
        ? "This tab minted a pairing code that hasn't been used yet — if nobody joins, it quietly forgets the session."
        : status === "connecting"
          ? "This tab is paired and reconnecting to its session…"
          : Number(peers) > 1
            ? `This tab is live in a session with ${peers} devices.`
            : "This tab is paired to a live session — no other device is connected right now."
  return <p className="mt-5 text-sm text-muted-foreground/80">Right here, right now: {text}</p>
}

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
    title: "What WebMCP is",
    body: "A browser API that lets a web page hand real, typed tools to the AI agent browsing with you — no pixel-guessing, no form-filling.",
  },
  {
    title: "Where it works",
    body: "ChatGPT's in-app browser out of the box; Google Chrome (desktop & Android) behind chrome://flags/#enable-webmcp-testing.",
  },
  {
    title: "What lights up",
    body: "The connection button in the app header — two dots: the agent dot (pulsing green = agent connected to this tab; solid green = opened from your ChatGPT conversation; grey = not connected) and the sync dot (green = other devices live in your session). Whatever the agent dot says, the panel always offers Open in ChatGPT and Copy prompt to bring an agent into this exact session.",
  },
  {
    title: "What the agent can do",
    body: `${TOOL_COUNT[0].toUpperCase()}${TOOL_COUNT.slice(1)} tools: read the design, reshape it, solve capacity exactly, switch units, see the 3D preview, and export the printable PDF — all in the same live session you're looking at.`,
  },
  {
    title: "Across devices",
    body: "Scan the Continue QR (inside the header's connection button), open the copyable link, or — in ChatGPT — just tap any link your agent hands you: that screen follows the design live, both ways, no WebMCP needed there. A spoken 6-character code remains the fallback.",
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
              <dt className="font-semibold tracking-tight text-foreground">{title}</dt>
              <dd className="mt-1 leading-relaxed text-foreground/75">{body}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-10 text-sm text-muted-foreground/80">
          That's the minute. Switch to the five-minute read for connection steps in both
          browsers, every tool, and the fine print.
        </p>
      </section>
    </>
  )
}

/* ------------------------------------------------------------ 5 minutes */

function FiveMinutes() {
  // flag detection = API presence: enabling chrome://flags/#enable-webmcp-testing
  // is exactly what makes registration succeed in a Chrome tab, so a "native"
  // agent state in real Chrome means the flag is already on
  const flagIsOn = useProjectStore((s) => s.agentStatus) === "native" && isRealChrome()
  return (
    <>
      {/* hero */}
      <section className="pt-12 pb-16">
        <StatusPill />
        <h1 className="mt-6 max-w-xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Your AI agent can use this app <span className="text-[#0A5BFF]">with you</span>.
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
          Unfolded is WebMCP&#8209;native. Open it in an agent&#8209;capable browser and the AI
          you're chatting with can see your pottery design, change it, check its capacity,
          and export the printable templates — live, in the same session you're looking at.
        </p>
      </section>

      {/* what is webmcp */}
      <section className="border-t border-border/60 py-14">
        <SectionLabel>What is WebMCP?</SectionLabel>
        <p className="mt-5 max-w-xl leading-relaxed text-foreground/75">
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
      <section className="border-t border-border/60 py-14">
        <SectionLabel>Try it in two ways</SectionLabel>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-border p-6">
            <h3 className="font-semibold tracking-tight">ChatGPT's in-app browser</h3>
            <p className="mt-1 text-sm text-muted-foreground/80">WebMCP works out of the box.</p>
            <ol className="mt-4 space-y-2.5 text-sm leading-relaxed text-foreground/75">
              <li>
                1. Easiest: tap the connection button in the header → <strong>Open in
                ChatGPT</strong>. The chat opens with the ask pre-written — this site plus a
                pairing code that links the agent to your tab. (Or open the site manually in
                the ChatGPT app's built-in browser.)
              </li>
              <li>2. Watch the connection button's agent dot turn green.</li>
              <li>3. Ask for the pot you want — the design changes as you chat.</li>
            </ol>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground/80">
              Heads up: tapping a link in the chat opens ChatGPT's <em>ordinary</em> in-app
              browser — a separate tab without WebMCP. When the agent minted that link, the
              tab says &ldquo;Opened from ChatGPT&rdquo;; the agent itself keeps editing
              in its own internal browser, and a live handoff link keeps the two in sync.
            </p>
          </div>
          <div className="rounded-2xl border border-border p-6">
            <h3 className="font-semibold tracking-tight">Google Chrome (desktop &amp; Android)</h3>
            <p className="mt-1 text-sm text-muted-foreground/80">Behind an experimental flag.</p>
            {flagIsOn && (
              <p className="rise-in mt-3 inline-flex items-center gap-1.5 rounded-full border border-emerald-600/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                <Check className="size-3.5 shrink-0" />
                Good news — your WebMCP flag is enabled in this Chrome session.
              </p>
            )}
            <ol className="mt-4 space-y-2.5 text-sm leading-relaxed text-foreground/75">
              <li>
                1. Open{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.8rem] break-all text-foreground/80">
                  chrome://flags/#enable-webmcp-testing
                </code>{" "}
                (on Android too; if it's missing, try Chrome Canary).
              </li>
              <li>2. Enable it and relaunch Chrome — the connection button's agent dot turns green.</li>
              <li>
                3. No agent attached? Drive the tools yourself from the DevTools console
                (desktop, or via <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.8rem] text-foreground/80">chrome://inspect</code> for
                a phone):{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.8rem] break-all text-foreground/80">
                  __unfoldedTools.set_capacity.execute({"{"}capacityMl: 350{"}"})
                </code>
              </li>
            </ol>
          </div>
        </div>
      </section>

      {/* the connection button and its dots */}
      <section className="border-t border-border/60 py-14">
        <SectionLabel>The connection button in the header</SectionLabel>
        <p className="mt-5 max-w-xl text-sm leading-relaxed text-foreground/75">
          One button carries both connection stories as two dots: the{" "}
          <span className="font-semibold text-foreground">first dot is your agent</span>{" "}
          (WebMCP), the{" "}
          <span className="font-semibold text-foreground">second is live sync</span> across
          your devices. Tap it for a plain-language readout of both, the{" "}
          <strong>Continue on another screen</strong> action, and the door to this page.
          The agent dot's states:
        </p>
        <ul className="mt-6 space-y-4">
          <li className="flex items-start gap-3">
            <span className="relative mt-1 flex size-2 shrink-0">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
            </span>
            <p className="text-sm leading-relaxed text-foreground/75">
              <span className="font-semibold text-foreground">WebMCP active</span> — the API is
              available in this very tab and the tools registered. You and the agent share one
              live session: every change either of you makes is visible to both.
            </p>
          </li>
          <li className="flex items-start gap-3">
            <span className="mt-1 inline-flex size-2 shrink-0 rounded-full bg-emerald-500" />
            <p className="text-sm leading-relaxed text-foreground/75">
              <span className="font-semibold text-foreground">Opened from ChatGPT</span> — this
              tab has no direct WebMCP, but the design arrived through a link the agent minted
              in your ChatGPT conversation. That is provenance, not pairing: the agent's
              default link is a <em>live handoff</em> carrying a single-use invitation, and
              tapping one makes this tab follow the agent's session both ways — the button's
              second dot turns green only when that is confirmed. If it's grey, ask the agent
              for a fresh live link.
            </p>
          </li>
          <li className="flex items-start gap-3">
            <span className="mt-1 inline-flex size-2 shrink-0 rounded-full bg-muted-foreground/40" />
            <p className="text-sm leading-relaxed text-foreground/75">
              <span className="font-semibold text-foreground">WebMCP</span> with a grey dot —
              neither could be confirmed in this tab. Ask ChatGPT to open Unfolded in its
              internal browser, or enable the Chrome flag above.
            </p>
          </li>
        </ul>
        <p className="mt-5 max-w-xl text-sm leading-relaxed text-foreground/75">
          The sync dot beside it: <span className="font-semibold text-foreground">green</span>{" "}
          when other devices are live in your session,{" "}
          <span className="font-semibold text-foreground">amber</span> while a paired device
          reconnects (offline edits are kept and sent), and{" "}
          <span className="font-semibold text-foreground">grey</span> when nothing is paired —
          or when a paired session is waiting for its other screen to come back.
        </p>
        <p className="mt-5 text-sm text-muted-foreground/80">
          Every state is honest by design: a ChatGPT connection is only ever shown on the
          explicit signal of an agent-minted link — never guessed from your browser's user
          agent — and pairing is never claimed for a session no second device actually joined.
        </p>
      </section>

      {/* across devices */}
      <section className="border-t border-border/60 py-14">
        <SectionLabel>Work across devices</SectionLabel>
        <p className="mt-5 max-w-xl leading-relaxed text-foreground/75">
          A design doesn't live in one chair — and the other chair needs no WebMCP, just a
          browser. Open <strong>Continue on another screen</strong> (inside the connection
          button — the two dots in the header) and scan its QR, or copy its link: the device that opens it follows
          this design live, both ways, within about a second — whoever made the edit, you
          or an agent. In ChatGPT it's even simpler: the agent's default link after any
          edit is a <em>live handoff</em> — tap it, and the tab you're looking at stays
          current with the agent's own browser from then on. Ask for a permanent link only
          when you want an independent copy to bookmark or print.
        </p>
        <ul className="mt-6 max-w-xl space-y-3 text-sm leading-relaxed text-foreground/75">
          <li>
            <span className="font-semibold text-foreground">One rule:</span> the device that{" "}
            <em>opens the link</em> (or enters the code) follows the other one's design — a
            single undo brings its previous design back. Afterwards no device is special.
          </li>
          <li>
            <span className="font-semibold text-foreground">Honest terms:</span> an
            invitation is single-use and short-lived — a link's token works once and dies
            (15 minutes at most), a spoken code once within 15. Whoever uses one can edit
            the design live. No URL ever carries a <em>durable</em> capability: a used link
            degrades to a plain design link, and the printed PDF QR never carries a session
            at all.
          </li>
          <li>
            <span className="font-semibold text-foreground">The code is always in view:</span>{" "}
            shown beside the QR in the same dialog, for when you can't scan or tap — read
            it aloud, or type it into ChatGPT{" "}
            <em>&ldquo;join my desktop session, code K7F&#8209;3QP&rdquo;</em>.
          </li>
          <li>
            <span className="font-semibold text-foreground">Comes back on its own:</span>{" "}
            phones freeze background tabs; every return to the tab reconnects and
            converges, and edits made offline are kept and sent.
          </li>
        </ul>
        <LiveSyncStatus />
      </section>

      {/* the tools */}
      <section className="border-t border-border/60 py-14">
        <SectionLabel>What your agent can do</SectionLabel>
        <dl className="mt-6 grid gap-x-10 gap-y-5 sm:grid-cols-2">
          {TOOL_SUMMARIES.map(({ name, blurb }) => (
            <div key={name}>
              <dt className="font-mono text-[13px] font-medium text-[#0646CC] dark:text-[#6b9aff]">{name}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">{blurb}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* prompts */}
      <section className="border-t border-border/60 py-14">
        <SectionLabel>Things to say</SectionLabel>
        <ul className="mt-6 space-y-3">
          {PROMPTS.map((prompt) => (
            <li
              key={prompt}
              className="rounded-xl border border-border bg-muted/50 px-5 py-3.5 text-[15px] text-foreground/80"
            >
              “{prompt}”
            </li>
          ))}
        </ul>
        <p className="mt-5 max-w-xl text-sm leading-relaxed text-muted-foreground/80">
          Everything the agent does passes through the same validation as the sliders, every
          response carries a share link that reopens the exact design, and templates are
          always shrinkage-compensated for your clay. And if the agent takes a wrong turn,
          undo is one tap — yours or its.
        </p>
      </section>

      {/* profiler */}
      <section className="border-t border-border/60 py-14">
        <SectionLabel>Curious where the time goes?</SectionLabel>
        <p className="mt-5 max-w-xl leading-relaxed text-foreground/75">
          Agent conversations can feel slow, so we measured: the tools themselves run in
          single-digit <em>milliseconds</em> — the seconds you feel are the model thinking
          between calls. Unfolded ships the instrument that proves it. Open any page with{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px]">?perf=overlay</code>{" "}
          and a small live panel appears: every tool call your agent makes, its timing, the
          size of what it read, and — the honest line — how much of the wait was the model,
          not the pottery math.
        </p>
        <ul className="mt-6 max-w-xl space-y-3 text-sm leading-relaxed text-foreground/75">
          <li>
            <span className="font-semibold text-foreground">Off unless you ask:</span>{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">?perf=1</code>{" "}
            turns it on for this browser (it remembers),{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">?perf=0</code>{" "}
            turns it off. Nothing is measured, stored, or sent otherwise — and even when on,
            everything stays in your tab.
          </li>
          <li>
            <span className="font-semibold text-foreground">For the console-inclined:</span>{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">__webmcpPerf.table()</code>{" "}
            in DevTools prints the per-tool numbers;{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">.export()</code>{" "}
            downloads the full report.
          </li>
          <li>
            <span className="font-semibold text-foreground">Built to travel:</span> born
            here when agent replies felt slow and the tool harness was the suspect (it
            was innocent — the model loop wasn't), the profiler is now a dependency-free
            package any WebMCP site can use:{" "}
            <a
              className="font-medium text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground"
              href="https://www.npmjs.com/package/webmcp-profiler"
              target="_blank"
              rel="noreferrer"
            >
              webmcp-profiler on npm
            </a>{" "}
            ·{" "}
            <a
              className="font-medium text-foreground/80 underline decoration-muted-foreground/40 underline-offset-4 transition-colors hover:text-foreground"
              href="https://github.com/lucaguglielmi/Unfolded-Web-MCP/tree/main/packages/webmcp-profiler"
              target="_blank"
              rel="noreferrer"
            >
              webmcp-profiler on GitHub
            </a>
            . One import, and your tools are measured too.
          </li>
        </ul>
        <p className="mt-5 max-w-xl text-sm leading-relaxed text-muted-foreground/80">
          Its first catch, fixed here: the 3D preview snapshot agents request was ~130 KB per
          look; it's ~7 KB now. Your agent got faster because the page timed itself.
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
const KICKSTART_PROMPT = `Open https://tryunfolded.com in your built-in browser. It's Unfolded, a parametric designer for slab-built pottery that registers WebMCP tools on document.modelContext the moment it loads — you get ${TOOL_COUNT} typed tools: ${TOOL_SUMMARIES.map((t) => t.name).join(", ")}. Start by calling describe_project to see the current design. Then help me design a piece: ask me what I want to make (shape, rough size or target capacity, my clay's shrinkage percent and slab thickness), apply it through the tools — all dimensions are FIRED sizes in millimeters; for a target volume use set_capacity, which solves the exact height in one call — and show me the result with get_preview_image. When I'm happy, run export_templates so I get the true-scale printable PDF, and then call create_live_handoff and give me its liveHandoffUrl exactly as returned — it's a single-use live link: when I open it, my browser follows your session and my edits show up in your next read (never send me the address-bar URL instead). If the tools aren't there yet, keep the page open: the site keeps watching for the WebMCP API and connects the moment your browser exposes it.`

function HumanEasterEgg() {
  const [copied, setCopied] = useState(false)
  const later = useTimeout()

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(KICKSTART_PROMPT)
      feedback("success")
      setCopied(true)
      later(() => setCopied(false), 1800)
    } catch {
      // clipboard can be unavailable (permissions, older webviews)
      window.prompt("Copy this prompt for your agent:", KICKSTART_PROMPT)
    }
  }

  return (
    <section className="py-14">
      <div className="rounded-2xl border border-[#0A5BFF]/25 bg-[#0A5BFF]/[0.03] dark:bg-[#0A5BFF]/[0.08] p-6">
        <h3 className="font-semibold tracking-tight">
          If you are human and clicked on this page — congratulations!
        </h3>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-foreground/75">
          The world is more interesting when people don't always do what they are told. If you
          want your agent to get started, copy this prompt and paste it inside any ChatGPT chat:
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-background px-3 py-2 font-mono text-[12px] text-muted-foreground">
            {KICKSTART_PROMPT.slice(0, 72)}…
          </code>
          <button
            type="button"
            onClick={copy}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/85"
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

/** dense, scrollable JSON — the visual grammar of the not-human view */
function JsonBlock({ label, data }: { label?: string; data: unknown }) {
  const text = useMemo(() => JSON.stringify(data, null, 2), [data])
  return (
    <div className="mt-4 min-w-0">
      {label && (
        <p className="mb-1.5 font-mono text-[11px] font-medium tracking-wide text-muted-foreground/80">
          {label}
        </p>
      )}
      <pre className="max-h-[26rem] overflow-auto rounded-xl border border-border bg-muted/50 p-4 font-mono text-[11px] leading-[1.6] whitespace-pre text-foreground/80">
        {text}
      </pre>
    </div>
  )
}

const AGENT_CONNECTION: [string, string][] = [
  ["Registration", "current WebMCP draft: document.modelContext.registerTool, awaited, all-or-nothing under one AbortController — the connection reads active only after the last tool resolves, and a replaced registry re-registers cleanly. Legacy hosts (navigator/window locations, provideContext, void returns) work via a compatibility layer. Registration is automatic — nothing for you to enable."],
  ["Late injection", "the app never stops watching: 500 ms polling for 15 s, then a 3 s heartbeat (paused while the tab is hidden), plus focus/visibility re-checks. Your execute() calls receive an options bag whose signal cancels cleanly — a cancelled mutation commits nothing. Executing any tool flips the app to connected."],
  ["Knowing you're in", "the header connection button's agent dot pulses green once your tools registered in this tab (its second dot is cross-device sync); the live status also renders at the top of this page. If it's grey, your host hasn't exposed WebMCP here."],
  ["Two links, never confused", "designUrl (in every state snapshot) is a permanent permalink: parameters only, reopens an independent copy — for explicit bookmark/print/archive asks. liveHandoffUrl comes ONLY from create_live_handoff: the same parameters plus ?via=chatgpt and a single-use ?join= token; the tab that opens it silently follows YOUR session both ways and strips the token. It is the default link after any edit — call the tool right before you reply, return it verbatim, never the address bar. Links parse forgivingly: legacy vocabulary normalizes, unknown keys are ignored, out-of-range values clamp."],
  ["Units contract", "tool inputs and outputs are millimeters and milliliters, always. set_units only changes what the human sees (UI, warnings, printed PDF)."],
  ["Full-state returns", "every mutation returns the complete snapshot — form, clay, paperSize, units, capacityMl, annotated pieces, printedPages, warnings, designUrl — so you never need a read-after-write. Snapshots are pure: they never mint or spend a live token."],
  ["Structured results", `every result carries its MCP-style content array and isError unchanged, plus a structuredContent object (contract ${TOOL_RESULT_CONTRACT}): { ok, message, state, warnings? } for the state-reporting tools — ok mirrors !isError and state deep-equals the JSON in the text; the handoff object, the template summary, and { pages, paper, rows, cols } for the export, each with ok and message; the preview keeps its image and adds { ok, message, summary }. Parse the object, skip the text.`],
  ["Manual driving", "window.__unfoldedTools exposes each registered tool: __unfoldedTools.set_capacity.execute({capacityMl: 350})."],
  ["Live sessions", "create_live_handoff invites the tap; join_session (the potter reads you a code) and start_pairing (you mint one for them) cover the spoken path. Once any device joins, syncing is transparent — peers' edits simply appear in your next read, so re-read before assuming state."],
]

const AGENT_PLAYBOOK: string[] = [
  "Call describe_project first — one read gives you the whole design. Finish with create_live_handoff whenever you hand back a link: it is the potter's way to continue in their own browser.",
  "For a target volume use set_capacity, never an update_form guessing loop: volume is linear in height and the tool solves it exactly.",
  "After a visual change, get_preview_image shows you exactly what the potter sees — verify before you announce.",
  "Errors come back as isError text with per-field issues AND the unchanged state — structuredContent says the same as { ok: false, message, state }; recover by correcting the field, not by re-reading.",
  "The human is your peer: they may edit between your calls (you'll see it in your next result), and undo_last_change reverts either of you.",
  "Pairing direction matters: the device that opens a link or enters a code ADOPTS this session's design. The potter wants to SEE your work elsewhere → create_live_handoff and hand them liveHandoffUrl verbatim, or start_pairing for a spoken code. The work lives on their other screen → ask for its code and join_session. If a live link fails to mint, send no link — retry once, then offer a code.",
]

function ForAgents() {
  const whyHref = useDesignHref("/why")
  const manifest = useMemo(() => buildAgentManifest(), [])
  const m = manifest as {
    application: { pipeline: unknown; invariants: string[]; formulas: unknown }
    tools: { name: string; title?: string; annotations: Record<string, unknown>; description: string; inputSchema: unknown }[]
    dataModel: Record<string, unknown>
    shareLinks: unknown
    liveSync: unknown
    profiler: unknown
    layoutConstants: unknown
    interactionModel: unknown
  }
  return (
    <>
      {/* the whole manifest, embedded as data for anything that parses DOM */}
      <script
        type="application/json"
        id="unfolded-agent-manifest"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(manifest) }}
      />

      <section className="pt-12 pb-14">
        <StatusPill />
        <h1 className="mt-6 max-w-xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Hello, agent. <span className="text-[#0A5BFF]">Here's everything.</span>
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
          This view is written to be parsed, not skimmed: the complete machine description of
          the application — pipeline, invariants, formulas, every tool's registered JSON
          Schema, the data model, the share-link grammar, and the live-sync protocol. All of
          it is derived at page load from the same zod schemas and tool registrations the app
          runs, so it cannot drift from the code. The identical document is embedded in this
          page as{" "}
          <Code>{'<script type="application/json" id="unfolded-agent-manifest">'}</Code>.
        </p>
      </section>

      <HumanEasterEgg />

      <section className="border-t border-border/60 py-14">
        <SectionLabel>How the connection works</SectionLabel>
        <dl className="mt-6 max-w-xl space-y-4 text-sm leading-relaxed">
          {AGENT_CONNECTION.map(([k, v]) => (
            <div key={k}>
              <dt className="font-semibold text-foreground">{k}</dt>
              <dd className="mt-0.5 text-foreground/75">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="border-t border-border/60 py-14">
        <SectionLabel>How the application works</SectionLabel>
        <p className="mt-5 max-w-xl text-sm leading-relaxed text-foreground/75">
          State flows one way: a validated store mutation (yours or the potter's) →
          closed-form unrolling of the developable surfaces → shelf-packed layout →
          paginated, true-scale PDF. The invariants below are contracts, not descriptions —
          rely on them.
        </p>
        <JsonBlock label="application.pipeline" data={m.application.pipeline} />
        <JsonBlock label="application.invariants" data={m.application.invariants} />
        <JsonBlock label="application.formulas (geometry, closed-form)" data={m.application.formulas} />
      </section>

      <section className="border-t border-border/60 py-14">
        <SectionLabel>The tool surface — registered JSON Schemas</SectionLabel>
        <p className="mt-5 max-w-xl text-sm leading-relaxed text-foreground/75">
          {TOOL_COUNT} tools, exactly as registered on <Code>document.modelContext</Code> in
          this tab — names, annotations, descriptions, and each input's JSON Schema.
        </p>
        <div className="mt-8 space-y-10">
          {m.tools.map((tool) => (
            <div key={tool.name} className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[13px] font-semibold text-[#0646CC] dark:text-[#6b9aff]">{tool.name}</span>
                {Object.entries(tool.annotations)
                  .filter(([k]) => k !== "title")
                  .map(([k, v]) => (
                    <span
                      key={k}
                      className="rounded-full border border-border bg-muted/50 px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
                    >
                      {k}={String(v)}
                    </span>
                  ))}
              </div>
              <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
                {tool.description}
              </p>
              <JsonBlock label={`${tool.name}.inputSchema`} data={tool.inputSchema} />
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-border/60 py-14">
        <SectionLabel>Data model — JSON Schema, presets, defaults</SectionLabel>
        <JsonBlock label="dataModel.formParams" data={m.dataModel.formParams} />
        <JsonBlock label="dataModel.claySettings" data={m.dataModel.claySettings} />
        <JsonBlock label="dataModel.presets" data={m.dataModel.presets} />
        <JsonBlock
          label="dataModel.defaults · papers · displayUnits"
          data={{
            defaults: m.dataModel.defaults,
            papers: m.dataModel.papers,
            displayUnits: m.dataModel.displayUnits,
          }}
        />
      </section>

      <section className="border-t border-border/60 py-14">
        <SectionLabel>Share-link grammar</SectionLabel>
        <JsonBlock label="shareLinks" data={m.shareLinks} />
      </section>

      <section className="border-t border-border/60 py-14">
        <SectionLabel>Live-sync protocol</SectionLabel>
        <JsonBlock label="liveSync" data={m.liveSync} />
      </section>

      <section className="border-t border-border/60 py-14">
        <SectionLabel>Performance introspection — profile yourself</SectionLabel>
        <p className="mt-5 max-w-xl text-sm leading-relaxed text-foreground/75">
          This tool surface carries its own analyser. Open any URL here with{" "}
          <Code>?perf=1</Code> (via <Code>open_model</Code>, if you like) and every call you
          make is spanned: wall time, payload bytes, the tokens your result costs you to
          read, and the gap the host + model spent thinking before your call arrived. Read
          it back with <Code>window.__webmcpPerf.report()</Code>. Known baseline: every tool
          here executes in single-digit milliseconds — if an interaction feels slow, the
          ledger will show you it isn't the page.
        </p>
        <JsonBlock label="profiler" data={m.profiler} />
      </section>

      <section className="border-t border-border/60 py-14">
        <SectionLabel>Constants &amp; interaction model</SectionLabel>
        <JsonBlock
          label="layoutConstants · interactionModel"
          data={{ layoutConstants: m.layoutConstants, interactionModel: m.interactionModel }}
        />
      </section>

      <section className="border-t border-border/60 py-14">
        <SectionLabel>Playbook</SectionLabel>
        <ul className="mt-6 max-w-xl space-y-4">
          {AGENT_PLAYBOOK.map((item) => (
            <li key={item} className="text-sm leading-relaxed text-foreground/75">
              {item}
            </li>
          ))}
        </ul>
        <p className="mt-8 max-w-xl text-sm leading-relaxed text-muted-foreground/80">
          For the narrative the humans read — why the app exists, who it serves — switch{" "}
          <a
            href={whyHref}
            className="font-medium text-foreground/75 underline decoration-muted-foreground/40 underline-offset-4 transition-colors hover:text-foreground"
          >
            /why
          </a>{" "}
          to its own not-human view. If the pill at the top is green, your tools are live in
          this tab — call <Code>describe_project</Code> and begin.
        </p>
      </section>
    </>
  )
}

/* ------------------------------------------------------------------ page */

export function WebMCPPage() {
  const [depth, setDepth] = useState<ReadingDepth>("5min")
  const whyHref = useDesignHref("/why")

  return (
    <div className="webmcp-page app-fade-in min-h-dvh bg-background text-foreground antialiased dark:bg-gradient-to-b dark:from-[#0a1122] dark:via-[#060a14] dark:to-[#04060c]">
      <ExplainerHeader current="webmcp" />

      {/* pb clears the fixed studio CTA bar */}
      <main className="mx-auto max-w-3xl px-6 pb-44">
        {/* reading-depth toolbar */}
        <ReadingDepthToolbar depth={depth} onChange={setDepth} />

        {/* keyed so switching depth re-runs the sections' entrance stagger */}
        <div key={depth}>
          {depth === "1min" ? <OneMinute /> : depth === "5min" ? <FiveMinutes /> : <ForAgents />}
        </div>

        {/* footer */}
        <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-border/60 pt-8">
          <p className="text-sm text-muted-foreground/80">
            Open source (MIT)
          </p>
          <div className="flex items-center gap-3">
            <a
              href={whyHref}
              className="text-sm font-medium text-foreground/75 transition-colors hover:text-foreground"
            >
              Why Unfolded
            </a>
            <a
              href="https://github.com/lucaguglielmi/Unfolded-Web-MCP"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground/75 transition-colors hover:text-foreground"
            >
              GitHub <ArrowUpRight className="size-3.5" />
            </a>
          </div>
        </footer>
      </main>

      <StudioCtaBar />
    </div>
  )
}
