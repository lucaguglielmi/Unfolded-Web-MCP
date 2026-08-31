import { useEffect, useState, useSyncExternalStore } from "react"
import { Check, Copy, Link as LinkIcon, MonitorSmartphone } from "lucide-react"
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
import { liveSync } from "@/store/syncClient"
import { useProjectStore } from "@/store/useProjectStore"

/**
 * "Continue on another screen" (docs/live-sync-spec.md v3): the design,
 * live, on your other device — which needs no WebMCP, only a browser.
 * Primary path: a QR carrying the share link plus a single-use join
 * token — scanning it pairs instantly (so does the copyable link). The
 * spoken 6-character code stays as the fallback, collapsed below. The
 * device that opens the link (or enters the code) follows THIS design;
 * afterwards both are live peers.
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

  // ---- code (fallback path) ----
  const [showCode, setShowCode] = useState(false)
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null)
  const [minting, setMinting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [entry, setEntry] = useState("")
  const [joining, setJoining] = useState(false)
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useLiveSync()
  const status = liveSync.status()
  const peers = liveSync.peers()
  const paired = liveSync.isPaired()

  const form = useProjectStore((s) => s.form)
  const clay = useProjectStore((s) => s.clay)
  const paperSize = useProjectStore((s) => s.paperSize)
  const unit = useProjectStore((s) => s.unit)

  // mint the invitation (token + QR) whenever the dialog opens or the
  // previous one expires while it is open
  const inviteExpired = invite !== null && invite.expiresAt <= now
  useEffect(() => {
    if (!open || (invite && !inviteExpired)) return
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
  }, [open, inviteExpired]) // eslint-disable-line react-hooks/exhaustive-deps

  // one ticking clock drives both countdowns
  const codeExpired = code !== null && code.expiresAt <= now
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
      window.setTimeout(() => setLinkCopied(false), 1500)
    } catch {
      window.prompt("Copy this link to continue on another screen:", invite.url)
    }
  }

  const mint = async () => {
    setNotice(null)
    setMinting(true)
    try {
      const minted = await liveSync.mintCode()
      if (minted) {
        setCode(minted)
        setNow(Date.now())
        feedback("success")
      } else {
        setNotice({ tone: "error", text: "Couldn't reach the pairing service — try again in a moment." })
      }
    } finally {
      setMinting(false)
    }
  }

  const copyCode = async () => {
    if (!activeCode) return
    // copy WITHOUT the dash — the dash is for reading aloud; entry
    // normalizes either form anyway
    try {
      await navigator.clipboard.writeText(activeCode.code)
      feedback("success")
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
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
          setShowCode(false)
          // never reuse an invite across opens: the tab may have joined a
          // DIFFERENT session since (a cached link would point at the one
          // it left) — tokens are cheap, mint fresh next time
          setInvite(null)
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

          {/* primary: scan or open the link — instant, no typing */}
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
            <button
              type="button"
              onClick={() => setShowCode((v) => !v)}
              className="hover:text-foreground uppercase transition-colors"
            >
              or use a code
            </button>
            <span className="bg-border h-px flex-1" />
          </div>

          {showCode && (
            <div className="rise-in flex flex-col gap-4">
              {activeCode ? (
                <div className="flex flex-col items-center gap-1.5">
                  {/* the code IS the copy button — one tap grabs it */}
                  <button
                    type="button"
                    onClick={copyCode}
                    aria-label="Copy pairing code"
                    title="Tap to copy"
                    className="hover:bg-accent group inline-flex items-center gap-3 rounded-lg border px-4 py-2 transition-colors"
                  >
                    <code className="font-mono text-3xl tracking-widest">
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
                </div>
              ) : (
                <Button onClick={mint} disabled={minting} variant="outline" className="w-full">
                  {minting ? "Creating…" : "Create a code to read aloud"}
                </Button>
              )}
              <p className="text-muted-foreground text-center text-xs leading-relaxed">
                For when you can't scan or tap — read it to the other device, or tell your
                assistant <em>"join my session, code …"</em>.
              </p>
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
