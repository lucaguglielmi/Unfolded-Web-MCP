import { useEffect, useState, useSyncExternalStore } from "react"
import { ArrowUpRight, Check, Copy, MonitorSmartphone } from "lucide-react"
import { PairDialog } from "@/components/PairDialog"
import { Button } from "@/components/ui/button"
import { feedback } from "@/lib/feedback"
import { cn } from "@/lib/utils"
import { useDesignHref } from "@/lib/useStudioHref"
import { liveSync } from "@/store/syncClient"
import { useProjectStore, type AgentStatus } from "@/store/useProjectStore"

/**
 * The header's one connection control: agent (WebMCP) and live sync as two
 * status dots on a single button, with a panel that explains both states in
 * plain language for wherever this tab actually is — ChatGPT's in-app
 * browser, a native WebMCP host, or a plain browser — and offers the two
 * actions that matter: Continue on another screen, the agent-prompt
 * buttons, and a How-does-it-work link to /webmcp.
 *
 * Honesty rules inherited unchanged from the pill and badge it replaces:
 * the agent dot never guesses from the user agent (green only on a real
 * registration or an explicit agent-minted link), and pairing is never
 * claimed for a session no second device ever joined.
 */

const AGENT: Record<
  AgentStatus,
  { title: string; label: string; dot: string; ping: boolean }
> = {
  native: {
    title: "Agent connected",
    label: "WebMCP active",
    dot: "bg-emerald-500",
    ping: true,
  },
  chatgpt: {
    title: "Opened from ChatGPT",
    label: "Connected via ChatGPT",
    dot: "bg-emerald-500",
    ping: false,
  },
  unavailable: {
    title: "Build with your agent",
    label: "WebMCP",
    dot: "bg-stone-300 dark:bg-slate-600",
    ping: false,
  },
}

/** browser-aware, most-useful-true-thing description of the agent state */
function agentDescription(agentStatus: AgentStatus): string {
  if (agentStatus === "native") {
    return "This tab is directly connected through WebMCP — you and the agent edit the same live design, and every change is one undo step, whoever made it."
  }
  if (agentStatus === "chatgpt") {
    return "This design arrived through a link your agent minted. Agent links are live invitations: tapping the latest one makes this tab follow the agent's session both ways — your edits here reach it on its next read."
  }
  // action-first, jargon-free: the buttons below do the work (Chrome's
  // experimental-flag hint lives in the dedicated nudge banner instead)
  return "Tap Open in ChatGPT below — or copy the prompt for any assistant — and it joins this exact design, live."
}

type SyncState = "none" | "alone" | "reconnecting" | "live"

const SYNC: Record<SyncState, { title: string; dot: string; description: string }> = {
  none: {
    title: "Not paired",
    dot: "border border-stone-300 dark:border-slate-600",
    description:
      "This tab syncs with no other device. Pair one and every edit — yours or an agent's — appears on both within about a second.",
  },
  alone: {
    title: "Paired, waiting",
    dot: "bg-stone-300 dark:bg-slate-600",
    description:
      "This device is in a live session, but no other device is connected right now. Reopen the design there, or invite a new screen below.",
  },
  reconnecting: {
    title: "Reconnecting…",
    dot: "bg-amber-500",
    description:
      "This device is paired and reconnecting to its session. Edits made meanwhile are kept and sent once the link is back.",
  },
  live: {
    title: "Synced live",
    dot: "bg-emerald-500",
    description: "", // composed with the live peer count below
  },
}

/** the paste-into-ChatGPT prompt: what the site is, and the single-use
    pairing code that makes the agent's tab join THIS session */
function agentPrompt(code: string, minutes: number): string {
  const pretty = `${code.slice(0, 3)}-${code.slice(3)}`
  return (
    `Open https://tryunfolded.com in your built-in browser — it's a parametric ` +
    `slab-pottery template designer that exposes WebMCP tools. Once it loads, call ` +
    `its join_session tool with code ${pretty} so you're editing the same live ` +
    `design I have open here (the code works once and expires in ${minutes} ` +
    `minutes). Then describe the current design and help me refine it.`
  )
}

export function ConnectionHub() {
  const [open, setOpen] = useState(false)
  const [pairOpen, setPairOpen] = useState(false)
  const [promptState, setPromptState] = useState<"idle" | "minting" | "copied" | "error">("idle")
  const [chatgptInvite, setChatgptInvite] = useState<{
    code: string
    expiresAt: number
    prompt: string
  } | null>(null)
  const agentStatus = useProjectStore((s) => s.agentStatus)
  const lastAgentCall = useProjectStore((s) => s.lastAgentCall)
  const webmcpHref = useDesignHref("/webmcp")

  useSyncExternalStore(
    (cb) => liveSync.subscribe(cb),
    () => `${liveSync.status()}:${liveSync.peers()}:${liveSync.everPeered()}`
  )
  const status = liveSync.status()
  const peers = liveSync.peers()
  const everPeered = liveSync.everPeered()

  // pairing is a claim about another device — never shown unless one was
  // actually in the session (an unused code's session shows as "none")
  const syncState: SyncState = !everPeered
    ? "none"
    : status === "connecting"
      ? "reconnecting"
      : status === "syncing" && peers > 1
        ? "live"
        : "alone"

  const agent = AGENT[agentStatus]
  const sync = SYNC[syncState]

  // the button label states the single most informative current fact; the
  // two dots always carry both states
  const label =
    syncState === "live"
      ? `${peers} devices`
      : syncState === "reconnecting"
        ? "syncing…"
        : agent.label

  // Pre-mint the pairing code while the panel is open so "Open in ChatGPT"
  // can be a REAL link (chatgpt.com/?q= injects the prompt into a new chat,
  // and on phones the universal link hands off into the ChatGPT app — which
  // only works reliably from a genuine anchor tap, not a scripted open
  // after an async mint). Codes are single-use and cheap, same as the
  // Continue dialog's eager QR tokens; a panel outliving the 5-minute TTL
  // re-mints just before expiry.
  useEffect(() => {
    if (!open || agentStatus !== "unavailable") return
    let cancelled = false
    let timer: number | undefined
    const mint = async () => {
      const minted = await liveSync.mintCode()
      if (cancelled) return
      if (!minted) {
        setChatgptInvite(null)
        return
      }
      const minutes = Math.max(1, Math.round((minted.expiresAt - Date.now()) / 60_000))
      setChatgptInvite({ ...minted, prompt: agentPrompt(minted.code, minutes) })
      timer = window.setTimeout(
        () => void mint(),
        Math.max(1_000, minted.expiresAt - Date.now() - 5_000)
      )
    }
    void mint()
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
      setChatgptInvite(null)
    }
  }, [open, agentStatus])

  const chatgptHref = chatgptInvite
    ? `https://chatgpt.com/?q=${encodeURIComponent(chatgptInvite.prompt)}`
    : null

  const copyAgentPrompt = async () => {
    if (promptState === "minting") return
    // reuse the pre-minted code (so link and copy carry the SAME code)
    // unless it's about to expire; mint fresh otherwise
    let prompt =
      chatgptInvite && chatgptInvite.expiresAt > Date.now() + 30_000
        ? chatgptInvite.prompt
        : null
    if (!prompt) {
      setPromptState("minting")
      const minted = await liveSync.mintCode()
      if (!minted) {
        setPromptState("error")
        window.setTimeout(() => setPromptState("idle"), 2500)
        return
      }
      const minutes = Math.max(1, Math.round((minted.expiresAt - Date.now()) / 60_000))
      prompt = agentPrompt(minted.code, minutes)
    }
    try {
      await navigator.clipboard.writeText(prompt)
      feedback("success")
      setPromptState("copied")
      window.setTimeout(() => setPromptState("idle"), 2000)
    } catch {
      window.prompt("Copy this prompt into ChatGPT:", prompt)
      setPromptState("idle")
    }
  }

  const syncDescription =
    syncState === "live"
      ? `${peers} devices are in this session — every edit here, or by an agent on any of them, appears on all within about a second.`
      : sync.description

  return (
    <div className="relative">
      <button
        type="button"
        data-connection-hub
        aria-expanded={open}
        aria-label={`Connections — agent: ${agent.label}; sync: ${sync.title}`}
        title="Agent & live-sync status"
        onClick={() => setOpen((o) => !o)}
        className="border-border text-foreground hover:bg-accent inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors"
      >
        <span className="flex items-center gap-1">
          <span className="relative flex size-2">
            {agent.ping && (
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            )}
            <span className={cn("relative inline-flex size-2 rounded-full", agent.dot)} />
          </span>
          <span className={cn("inline-flex size-2 rounded-full", sync.dot)} />
        </span>
        {/* phones get the dots only — the panel spells everything out */}
        <span className="hidden sm:inline">{label}</span>
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            data-no-feedback
            className="fixed inset-0 z-40 !cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="bg-background absolute top-full right-0 z-50 mt-2 w-80 rounded-xl border p-4 shadow-lg">
            {/* agent (WebMCP) */}
            <div className="flex items-start gap-2.5">
              <span className="relative mt-1 flex size-2 shrink-0">
                {agent.ping && (
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                )}
                <span className={cn("relative inline-flex size-2 rounded-full", agent.dot)} />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold tracking-tight">{agent.title}</p>
                <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                  {agentDescription(agentStatus)}
                </p>
                {lastAgentCall && (
                  <p className="text-muted-foreground mt-1 truncate text-xs">
                    last agent call: <code className="text-foreground/80">{lastAgentCall.tool}</code>
                  </p>
                )}
                <a
                  href={webmcpHref}
                  className="text-foreground mt-1.5 inline-flex items-center gap-1 text-xs font-medium hover:underline"
                  onClick={() => setOpen(false)}
                >
                  How does it work <ArrowUpRight className="size-3" />
                </a>
                {agentStatus === "unavailable" && (
                  // compact sizing: the pair must fit the panel's width on
                  // phones without the row overflowing
                  <div className="mt-2.5 flex gap-1.5">
                    {chatgptHref ? (
                      <Button asChild variant="secondary" size="sm" className="min-w-0 flex-1 px-2 text-xs">
                        <a
                          href={chatgptHref}
                          target="_blank"
                          rel="noopener"
                          data-chatgpt-prompt
                          aria-label="Open ChatGPT with a prompt that visits this site and pairs with this session"
                          onClick={() => setOpen(false)}
                        >
                          <ArrowUpRight className="size-3.5" />
                          Open in ChatGPT
                        </a>
                      </Button>
                    ) : (
                      <Button variant="secondary" size="sm" className="min-w-0 flex-1 px-2 text-xs" disabled>
                        Preparing…
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      className={cn(
                        "min-w-0 flex-1 px-2 text-xs",
                        promptState === "copied" && "text-emerald-600",
                        promptState === "error" && "text-red-600"
                      )}
                      onClick={() => void copyAgentPrompt()}
                      aria-label="Copy a prompt that opens this site and pairs with this session"
                    >
                      {promptState === "copied" ? (
                        <>
                          <Check className="size-3.5" /> Copied
                        </>
                      ) : promptState === "error" ? (
                        <>Retry</>
                      ) : promptState === "minting" ? (
                        <>Preparing…</>
                      ) : (
                        <>
                          <Copy className="size-3.5" /> Copy prompt
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-border my-3 h-px" />

            {/* live sync */}
            <div className="flex items-start gap-2.5">
              <span className={cn("mt-1 inline-flex size-2 shrink-0 rounded-full", sync.dot)} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold tracking-tight">{sync.title}</p>
                <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                  {syncDescription}
                </p>
                {agentStatus === "chatgpt" && syncState === "none" && (
                  <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                    Tip: asking your agent for its latest link pairs <em>this</em> tab with
                    one tap.
                  </p>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-2.5 w-full"
                  aria-label="Continue on another screen"
                  onClick={() => {
                    setOpen(false)
                    setPairOpen(true)
                  }}
                >
                  <MonitorSmartphone className="size-4" />
                  Continue on another screen
                </Button>
              </div>
            </div>
          </div>
        </>
      )}

      <PairDialog open={pairOpen} onOpenChange={setPairOpen} />
    </div>
  )
}
