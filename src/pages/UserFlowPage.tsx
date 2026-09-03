import {
  ArrowLeft,
  Bot,
  Globe2,
  Link2,
  MonitorSmartphone,
  ShieldCheck,
  Workflow,
} from "lucide-react"
import { LogoMark } from "@/components/LogoMark"
import { useStudioHref } from "@/lib/useStudioHref"

const scenarios = [
  {
    icon: Bot,
    title: "ChatGPT agent browser",
    status: "Direct WebMCP",
    body: "ChatGPT opens Unfolded in its internal agent browser. The app registers all 11 tools, so the agent reads and edits the same tab directly — and on a fresh session its first reply offers \"Open a paired browser session with this chat\", the link that puts the same design on your own screen.",
    tone: "violet",
  },
  {
    icon: Globe2,
    title: "Chrome with WebMCP enabled",
    status: "Tools available",
    body: "The tab exposes the WebMCP API and Unfolded registers its tools. The flag proves the API is present; it does not by itself prove an agent is attached.",
    tone: "blue",
  },
  {
    icon: MonitorSmartphone,
    title: "Browser without WebMCP",
    status: "Full editor, no direct tools",
    body: "Safari, Firefox, ordinary Chrome and other browsers still get the complete visual editor. Open ChatGPT from the connection panel to add an agent through live sync.",
    tone: "stone",
  },
  {
    icon: Link2,
    title: "A link opened from ChatGPT",
    status: "Live sync, WebMCP optional",
    body: "A tapped chat link normally opens an ordinary browser tab. A fresh live handoff token pairs it with the agent's tab, so changes still move both ways.",
    tone: "orange",
  },
] as const

const toneClasses = {
  violet:
    "border-violet-200 bg-violet-50/70 text-violet-950 dark:border-violet-400/20 dark:bg-violet-500/10 dark:text-violet-100",
  blue: "border-blue-200 bg-blue-50/70 text-blue-950 dark:border-blue-400/20 dark:bg-blue-500/10 dark:text-blue-100",
  stone:
    "border-stone-200 bg-stone-50/70 text-stone-950 dark:border-slate-600/40 dark:bg-slate-500/10 dark:text-slate-100",
  orange:
    "border-orange-200 bg-orange-50/70 text-orange-950 dark:border-orange-400/20 dark:bg-orange-500/10 dark:text-orange-100",
} as const

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground/80 uppercase">
      {children}
    </p>
  )
}

function Diagram({
  src,
  alt,
  caption,
}: {
  src: string
  alt: string
  caption: string
}) {
  return (
    <figure className="mt-7 overflow-hidden rounded-3xl border border-border/70 bg-white p-3 shadow-sm sm:p-6">
      <img src={src} alt={alt} className="mx-auto h-auto w-full" loading="lazy" />
      <figcaption className="border-t border-stone-200 px-3 pt-4 pb-1 text-center text-sm leading-relaxed text-stone-500">
        {caption}
      </figcaption>
    </figure>
  )
}

export function UserFlowPage() {
  const studioHref = useStudioHref()

  return (
    <div className="app-fade-in min-h-dvh bg-background text-foreground antialiased dark:bg-gradient-to-b dark:from-[#0a1122] dark:via-[#060a14] dark:to-[#04060c]">
      <header className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-5">
        <div className="flex items-center gap-2.5">
          <LogoMark animated className="h-5 w-auto" />
          <span className="text-base font-semibold tracking-tight">unfolded</span>
        </div>
        <a
          href={studioHref}
          className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-accent"
        >
          <ArrowLeft className="size-4" />
          Back to Unfolded
        </a>
      </header>

      <main className="mx-auto max-w-5xl px-6 pb-24">
        <section className="pt-14 pb-16 sm:pt-20">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-[#0A5BFF] text-white shadow-lg shadow-blue-600/20">
            <Workflow className="size-6" />
          </div>
          <h1 className="mt-7 max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
            One design, wherever the conversation starts.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground sm:text-xl">
            WebMCP gives an agent direct tools inside a supported tab. Unfolded's live-sync
            layer carries the same design into every other browser—even when that browser has
            no WebMCP support.
          </p>
        </section>

        <section className="border-t border-border/60 py-14">
          <SectionLabel>Four browser situations</SectionLabel>
          <div className="mt-7 grid gap-4 sm:grid-cols-2">
            {scenarios.map(({ icon: Icon, title, status, body, tone }) => (
              <article key={title} className={`rounded-2xl border p-6 ${toneClasses[tone]}`}>
                <Icon className="size-5" />
                <h2 className="mt-5 text-lg font-semibold tracking-tight">{title}</h2>
                <p className="mt-1 text-xs font-semibold tracking-wide uppercase opacity-65">
                  {status}
                </p>
                <p className="mt-4 text-sm leading-relaxed opacity-75">{body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="border-t border-border/60 py-14">
          <SectionLabel>Flow 1 · Start in a browser</SectionLabel>
          <h2 className="mt-5 max-w-2xl text-3xl font-semibold tracking-tight text-balance">
            A browser without WebMCP can still bring ChatGPT into the design.
          </h2>
          <p className="mt-4 max-w-2xl leading-relaxed text-muted-foreground">
            Nothing is blocked when the API is missing. The person designs normally, then the
            connection panel creates a short-lived code and a ready-made prompt. ChatGPT opens
            its own capable tab, claims the code and joins the same session.
          </p>
          <Diagram
            src="/diagrams/browser-first.svg"
            alt="Flow showing how browsers with and without WebMCP reach a live Unfolded session"
            caption="The browser remains the visual workspace; WebMCP decides only whether an agent can call tools in that exact tab."
          />
        </section>

        <section className="border-t border-border/60 py-14">
          <SectionLabel>Flow 2 · Start in ChatGPT</SectionLabel>
          <h2 className="mt-5 max-w-2xl text-3xl font-semibold tracking-tight text-balance">
            The agent designs first, then hands the live work back to any browser.
          </h2>
          <p className="mt-4 max-w-2xl leading-relaxed text-muted-foreground">
            After the final edit, the agent creates a fresh live handoff link. A valid token
            joins the opening tab to the session and immediately disappears from the address
            bar. WebMCP on that new tab is useful, but not required for live collaboration.
          </p>
          <Diagram
            src="/diagrams/chatgpt-first.svg"
            alt="Flow showing a ChatGPT-created Unfolded design continuing in browsers with or without WebMCP"
            caption="An expired or previously used invitation fails safely: the encoded design still opens, but as an independent copy."
          />
        </section>

        <section className="border-t border-border/60 py-14">
          <SectionLabel>Flow 3 · Continue on another screen</SectionLabel>
          <h2 className="mt-5 max-w-2xl text-3xl font-semibold tracking-tight text-balance">
            Link, QR or spoken code: three entrances to the same live session.
          </h2>
          <p className="mt-4 max-w-2xl leading-relaxed text-muted-foreground">
            QR codes and links are the quickest route between physical screens. The
            six-character code is the conversational route: read it aloud or paste it into
            ChatGPT, which joins through the <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.9em]">join_session</code> tool.
          </p>
          <Diagram
            src="/diagrams/cross-device.svg"
            alt="Flow showing QR, live link and pairing-code routes into an Unfolded live session"
            caption="Invitations work once and expire after 15 minutes. The session itself stays live after a successful claim."
          />
        </section>

        <section className="border-y border-border/60 py-14">
          <div className="grid gap-8 md:grid-cols-[1fr_1.35fr]">
            <div>
              <div className="flex size-11 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <ShieldCheck className="size-5" />
              </div>
              <h2 className="mt-5 text-2xl font-semibold tracking-tight">
                No WebMCP? Nothing breaks.
              </h2>
            </div>
            <ul className="space-y-5 text-sm leading-relaxed text-foreground/75">
              <li>
                <strong className="text-foreground">The full editor still works.</strong> Shape,
                clay, units, 3D preview and PDF export stay available to the person.
              </li>
              <li>
                <strong className="text-foreground">Live sync is independent.</strong> Any modern
                browser can follow an agent's session without exposing WebMCP itself.
              </li>
              <li>
                <strong className="text-foreground">Connection status stays honest.</strong> The
                agent dot reports tool availability; the separate sync dot reports live peers.
              </li>
              <li>
                <strong className="text-foreground">Failed invitations are safe.</strong> A used,
                expired or invalid token opens only the design snapshot—never a durable session.
              </li>
            </ul>
          </div>
        </section>

        <footer className="py-10 text-sm text-muted-foreground/80">
          D2 source files live beside the documentation; the page embeds their generated SVGs.
        </footer>
      </main>
    </div>
  )
}
