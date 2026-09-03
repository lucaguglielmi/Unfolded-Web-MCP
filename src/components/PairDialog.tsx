import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { Check, Copy, KeyRound, Link as LinkIcon, MonitorSmartphone } from "lucide-react"
import { LogoMark } from "@/components/LogoMark"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { feedback } from "@/lib/feedback"
import { shareUrl } from "@/lib/model/shareLink"
import { useIsDesktop } from "@/lib/useIsDesktop"
import { useTimeout } from "@/lib/useTimeout"
import { liveSync } from "@/store/syncClient"
import { useProjectStore } from "@/store/useProjectStore"

/**
 * "Continue on another screen" (docs/live-sync-spec.md §9): the design,
 * live, on your other device — which needs no WebMCP, only a browser.
 * Primary path: a QR carrying the share link plus a single-use join
 * token — scanning it pairs instantly (so does the copyable link). The
 * spoken 6-character code is minted with it and always shown beside it:
 * read aloud to the other screen, or typed into a chat so the agent
 * joins with join_session. Entering a code FROM another screen sits
 * behind a toggle. The device that opens the link (or enters the code)
 * follows THIS design; afterwards both are live peers.
 */

const pretty = (code: string) => `${code.slice(0, 3)}-${code.slice(3)}`

function useLiveSync() {
  return useSyncExternalStore(
    (cb) => liveSync.subscribe(cb),
    () => `${liveSync.status()}:${liveSync.peers()}:${liveSync.everPeered()}`
  )
}

export function PairDialog({
  open: controlledOpen,
  onOpenChange,
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
} = {}) {
  // uncontrolled by default (own trigger in the desktop header); controlled
  // from the mobile menu, which then renders no trigger — same pattern as
  // ShareDialog
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : uncontrolledOpen
  const setOpen = (next: boolean) =>
    isControlled ? onOpenChange?.(next) : setUncontrolledOpen(next)

  const isDesktop = useIsDesktop()
  const otherScreen = isDesktop ? "your phone" : "desktop"

  // ---- QR + link (primary path) ----
  const [invite, setInvite] = useState<{ url: string; qr: string | null; expiresAt: number } | null>(null)
  const [linkCopied, setLinkCopied] = useState(false)
  const unflashLink = useTimeout()

  // ---- spoken code (always shown beside the QR) ----
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null)
  const [codeError, setCodeError] = useState(false)
  const [copied, setCopied] = useState(false)
  // ---- entering a code from another screen ----
  const [showEntry, setShowEntry] = useState(false)
  const unflashCode = useTimeout()
  const [entry, setEntry] = useState("")
  const [joining, setJoining] = useState(false)
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useLiveSync()
  const status = liveSync.status()
  const peers = liveSync.peers()
  const paired = liveSync.isPaired()
  const live = status === "syncing" && peers > 1

  // deliberately inviting a THIRD screen while already live re-enables the
  // QR/link section below
  const [addingAnother, setAddingAnother] = useState(false)

  const agentStatus = useProjectStore((s) => s.agentStatus)
  const form = useProjectStore((s) => s.form)
  const clay = useProjectStore((s) => s.clay)
  const paperSize = useProjectStore((s) => s.paperSize)
  const unit = useProjectStore((s) => s.unit)

  // mint the invitation (token + QR) whenever the dialog opens or the
  // previous one expires while it is open
  const inviteExpired = invite !== null && invite.expiresAt <= now
  useEffect(() => {
    // while live (and not deliberately adding a third screen) mint nothing:
    // the success panel replaces the QR, and a fresh invitation would only
    // pretend the spent one still worked
    if (!open || (live && !addingAnother) || (invite && !inviteExpired)) return
    let cancelled = false
    void (async () => {
      const minted = await liveSync.mintToken()
      if (cancelled) return
      if (!minted) {
        setInvite(null)
        setNotice({ tone: "error", text: "Couldn't reach the pairing service — try again in a moment." })
        return
      }
      const url = shareUrl(form, clay, paperSize, { unit, joinToken: minted.token })
      let qr: string | null = null
      try {
        const { toDataURL } = await import("qrcode")
        qr = await toDataURL(url, {
          margin: 1,
          width: 512,
          errorCorrectionLevel: "H",
          color: { dark: "#1c1917", light: "#ffffff" },
        })
      } catch {
        // QR lib unavailable — the copyable link still works
      }
      if (!cancelled) setInvite({ url, qr, expiresAt: minted.expiresAt })
    })()
    return () => {
      cancelled = true
    }
    // the invite deliberately does NOT re-mint on every design edit — the
    // link's design params are a snapshot, but the joined device adopts the
    // SESSION's live state anyway (adopt-on-join), so staleness is harmless
  }, [open, inviteExpired, live, addingAnother]) // eslint-disable-line react-hooks/exhaustive-deps

  // HONESTY: a QR/link/code is single-use, so the moment the other screen
  // claims it (peers rises and we're live) the displayed invitation is
  // spent — stop showing it and its countdown, and say what happened.
  // The functional setNotice keeps the joiner's own "Paired — this device
  // now follows that session." message when THIS device was the joiner.
  const wasLive = useRef(live)
  useEffect(() => {
    const was = wasLive.current
    wasLive.current = live
    if (!live) return
    setInvite(null)
    setCode(null)
    setAddingAnother(false)
    if (open && !was) {
      setNotice((n) => n ?? { tone: "ok", text: "Your other screen joined — edits now sync live, both ways." })
    }
  }, [live, open])

  // The spoken code is minted right alongside the invitation — it is the
  // path for typing into a chat ("join my session, code …") and has to
  // simply be there when the dialog opens, never behind a button. Same
  // lifecycle as the QR: re-minted when it expires while open, cleared
  // once the other screen joins, none while a failure is being shown
  // (the retry button clears the failure and this effect mints again).
  const codeExpired = code !== null && code.expiresAt <= now
  useEffect(() => {
    if (!open || (live && !addingAnother) || (code && !codeExpired) || codeError) return
    let cancelled = false
    void (async () => {
      const minted = await liveSync.mintCode()
      if (cancelled) return
      if (minted) {
        setCode(minted)
        setNow(Date.now())
      } else {
        setCodeError(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, codeExpired, live, addingAnother, codeError]) // eslint-disable-line react-hooks/exhaustive-deps

  // one ticking clock drives both countdowns
  const activeCode = code && !codeExpired ? code : null
  useEffect(() => {
    if (!open) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [open])

  const copyLink = async () => {
    if (!invite) return
    try {
      await navigator.clipboard.writeText(invite.url)
      feedback("success")
      setLinkCopied(true)
      unflashLink(() => setLinkCopied(false), 1500)
    } catch {
      window.prompt("Copy this link to continue on another screen:", invite.url)
    }
  }

  const retryCode = () => {
    setNotice(null)
    setCodeError(false)
  }

  const copyCode = async () => {
    if (!activeCode) return
    // copy WITHOUT the dash — the dash is for reading aloud; entry
    // normalizes either form anyway
    try {
      await navigator.clipboard.writeText(activeCode.code)
      feedback("success")
      setCopied(true)
      unflashCode(() => setCopied(false), 1500)
    } catch {
      window.prompt("Copy this pairing code:", activeCode.code)
    }
  }

  const join = async () => {
    setNotice(null)
    setJoining(true)
    try {
      const result = await liveSync.joinWithCode(entry)
      if (result.ok) {
        setEntry("")
        setCode(null)
        setNotice({ tone: "ok", text: "Paired — this device now follows that session." })
        feedback("success")
      } else {
        setNotice({
          tone: "error",
          text: result.retryable
            ? "Too many attempts right now — wait a minute and try again."
            : "That code didn't work — codes expire and can be used once. Ask for a fresh one.",
        })
      }
    } finally {
      setJoining(false)
    }
  }

  const unpair = () => {
    liveSync.unpair()
    setCode(null)
    setInvite(null)
    setAddingAnother(false)
    setNotice({ tone: "ok", text: "Unpaired — this device keeps the design, but stops syncing." })
  }

  const mmss = (ms: number) => {
    const s = Math.max(0, Math.ceil(ms / 1000))
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setNotice(null)
          setShowEntry(false)
          setAddingAnother(false)
          // never reuse an invitation across opens: the tab may have joined
          // a DIFFERENT session since (a cached link or code would point at
          // the one it left) — both are cheap, mint fresh next time
          setInvite(null)
          setCode(null)
          setCodeError(false)
        }
      }}
    >
      {!isControlled && (
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Continue on another screen"
            title="Continue on another screen"
          >
            <MonitorSmartphone className="size-4" />
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Continue on {otherScreen}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {status === "syncing" && peers > 1 && (
            <p className="text-center text-xs font-medium text-emerald-600">
              Synced live — {peers} devices
            </p>
          )}

          {/* browser-aware guidance: say the most useful true thing for
              where this tab actually is */}
          {agentStatus === "chatgpt" ? (
            <p className="bg-muted text-muted-foreground rounded-lg px-3 py-2 text-xs leading-relaxed">
              You're viewing through ChatGPT. The easiest way to pair: <strong>ask your
              agent for a live link</strong> — its default link is a single-use live
              invitation, and tapping it keeps this very tab in sync. The QR below works
              for any <em>other</em> device.
            </p>
          ) : agentStatus === "native" ? (
            <p className="bg-muted text-muted-foreground rounded-lg px-3 py-2 text-xs leading-relaxed">
              An agent is connected to this tab — its default link is a fresh live
              invitation, so you can also just ask it to <em>&ldquo;send me the latest
              link&rdquo;</em> for any other screen.
            </p>
          ) : null}

          {/* primary: scan or open the link — instant, no typing. While
              live, the single-use invitation is spent, so an honest success
              panel replaces the QR instead of a countdown on a dead code */}
          {live && !addingAnother ? (
            <div className="rise-in flex flex-col items-center gap-3 rounded-lg border border-emerald-600/30 bg-emerald-600/5 px-4 py-5 text-center">
              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                Your screens are linked
              </p>
              <p className="text-muted-foreground text-xs leading-relaxed">
                Edits made on any of them appear on all, live. The invitation you shared
                is spent — each QR, link, or code works exactly once.
              </p>
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => setAddingAnother(true)}
              >
                Invite another screen
              </Button>
            </div>
          ) : (
            <>
              <div className="flex flex-col items-center gap-3">
                {invite?.qr ? (
                  <div className="rise-in relative">
                    <img
                      src={invite.qr}
                      alt="Scan to continue this design, live, on another device"
                      className="size-44 rounded-lg border p-2"
                    />
                    <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md bg-white px-1.5 py-1">
                      <LogoMark className="h-5 w-auto" />
                    </span>
                  </div>
                ) : (
                  <div className="text-muted-foreground flex size-44 items-center justify-center rounded-lg border text-xs">
                    preparing…
                  </div>
                )}
                <Button
                  onClick={copyLink}
                  variant="secondary"
                  className="w-full"
                  disabled={!invite}
                  data-continue-url={invite?.url ?? ""}
                >
                  {linkCopied ? (
                    <>
                      <Check className="size-4" /> Copied
                    </>
                  ) : (
                    <>
                      <LinkIcon className="size-4" /> Copy link
                    </>
                  )}
                </Button>
                <p className="text-muted-foreground text-center text-xs leading-relaxed">
                  Scan or open on {otherScreen} — it needs no WebMCP, just a browser — and it
                  follows this design live, both ways. The invitation works once
                  {invite ? ` and expires in ${mmss(invite.expiresAt - now)}` : ""}; anyone who
                  uses it can edit this design.
                </p>
              </div>

              <div className="text-muted-foreground flex items-center gap-3 text-[11px] uppercase">
                <span className="bg-border h-px flex-1" />
                <span>or by code</span>
                <span className="bg-border h-px flex-1" />
              </div>

              {/* the spoken code, always in view: read it aloud, or type it
                  into a chat so the agent joins with join_session */}
              <div className="flex flex-col items-center gap-1.5">
                {activeCode ? (
                  <>
                    {/* the code IS the copy button — one tap grabs it */}
                    <button
                      type="button"
                      onClick={copyCode}
                      aria-label="Copy pairing code"
                      title="Tap to copy"
                      className="hover:bg-accent group inline-flex items-center gap-3 rounded-lg border px-4 py-2 transition-colors"
                    >
                      <code data-pairing-code className="font-mono text-3xl tracking-widest">
                        {pretty(activeCode.code)}
                      </code>
                      {copied ? (
                        <Check className="size-4 text-emerald-600" />
                      ) : (
                        <Copy className="text-muted-foreground size-4 opacity-60 group-hover:opacity-100" />
                      )}
                    </button>
                    <p className="text-muted-foreground text-xs">
                      {copied
                        ? "copied — paste it on the other device"
                        : `tap to copy · expires in ${mmss(activeCode.expiresAt - now)}`}
                    </p>
                  </>
                ) : codeError ? (
                  <Button onClick={retryCode} variant="outline" className="w-full">
                    Couldn't reach the pairing service — retry
                  </Button>
                ) : (
                  <div className="text-muted-foreground inline-flex items-center rounded-lg border px-4 py-2">
                    <span className="font-mono text-3xl tracking-widest">···-···</span>
                  </div>
                )}
                <p className="text-muted-foreground text-center text-xs leading-relaxed">
                  Type it on {otherScreen}: connection button → <strong>Continue on another
                  screen</strong> → <strong>Enter a code from another screen</strong>. Or type it
                  into ChatGPT:{" "}
                  <em>&ldquo;join my Unfolded session, code {activeCode ? pretty(activeCode.code) : "K7F-3QP"}&rdquo;</em>
                  {" "}— the agent joins with <span className="font-mono">join_session</span>. Works
                  once, valid 15 minutes.
                </p>
              </div>
            </>
          )}

          {/* the other direction: THIS device follows a session whose code
              came from another screen (or an agent's start_pairing) */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowEntry((v) => !v)}
            aria-expanded={showEntry}
            className="w-full"
          >
            <KeyRound className="size-4" />
            Enter a code from another screen
          </Button>

          {showEntry && (
            <div className="rise-in flex flex-col gap-3">
              <div className="flex gap-2">
                <Input
                  value={entry}
                  onChange={(e) => setEntry(e.target.value.toUpperCase())}
                  placeholder="K7F-3QP"
                  aria-label="Pairing code from your other device"
                  className="font-mono tracking-widest"
                  maxLength={8}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && entry.trim()) void join()
                  }}
                />
                <Button onClick={join} disabled={joining || !entry.trim()} variant="secondary">
                  {joining ? "Joining…" : "Join"}
                </Button>
              </div>
              <p className="text-muted-foreground text-center text-xs leading-relaxed">
                Got a code from another device? Entering it makes <strong>this</strong> device
                follow that session (one undo step brings your current design back).
              </p>
            </div>
          )}

          {notice && (
            <p
              className={`text-center text-xs ${notice.tone === "ok" ? "text-emerald-600" : "text-red-600"}`}
            >
              {notice.text}
            </p>
          )}

          {paired && (
            <Button onClick={unpair} variant="ghost" size="sm" className="text-muted-foreground">
              Unpair this device
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
