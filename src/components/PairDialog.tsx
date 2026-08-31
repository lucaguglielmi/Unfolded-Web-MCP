import { useEffect, useState, useSyncExternalStore } from "react"
import { MonitorSmartphone } from "lucide-react"
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
import { liveSync } from "@/store/syncClient"

/**
 * Device pairing (docs/live-sync-spec.md §4): mint a 6-character code here
 * and speak it to the other device — or to the agent in a chat, where
 * links don't survive but a code does. The device that ENTERS a code
 * follows the session of the device that minted it; after that both are
 * live peers. Honest like the rest of the header: every state shown is
 * something the socket confirmed.
 */

const pretty = (code: string) => `${code.slice(0, 3)}-${code.slice(3)}`

function useLiveSync() {
  return useSyncExternalStore(
    (cb) => liveSync.subscribe(cb),
    () => `${liveSync.status()}:${liveSync.peers()}`
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
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null)
  const [minting, setMinting] = useState(false)
  const [entry, setEntry] = useState("")
  const [joining, setJoining] = useState(false)
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useLiveSync()
  const status = liveSync.status()
  const peers = liveSync.peers()
  const paired = liveSync.isPaired()

  // drive the code countdown; an expired code is simply not shown (derived
  // in render — no state write needed to make it disappear)
  const remainingMs = code ? code.expiresAt - now : 0
  const activeCode = code && remainingMs > 0 ? code : null
  useEffect(() => {
    if (!activeCode) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [activeCode])

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
            : "That code didn't work — codes expire after 5 minutes and can be used once. Ask for a fresh one.",
        })
      }
    } finally {
      setJoining(false)
    }
  }

  const unpair = () => {
    liveSync.unpair()
    setCode(null)
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
        if (!next) setNotice(null)
      }}
    >
      {!isControlled && (
        <DialogTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Pair a device" title="Pair a device">
            <MonitorSmartphone className="size-4" />
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Pair a device</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {status === "syncing" && peers > 1 && (
            <p className="text-center text-xs font-medium text-emerald-600">
              Synced live — {peers} devices
            </p>
          )}

          {activeCode ? (
            <div className="rise-in flex flex-col items-center gap-1.5">
              <code className="rounded-lg border px-4 py-2 font-mono text-3xl tracking-widest">
                {pretty(activeCode.code)}
              </code>
              <p className="text-muted-foreground text-xs">expires in {mmss(remainingMs)}</p>
            </div>
          ) : (
            <Button onClick={mint} disabled={minting} className="w-full">
              {minting ? "Creating…" : "Create pairing code"}
            </Button>
          )}
          <p className="text-muted-foreground text-center text-xs leading-relaxed">
            Read this code to your other device — or tell your assistant{" "}
            <em>"join my session, code …"</em>. Anyone who enters it within 5 minutes can
            edit this design live.
          </p>

          <div className="text-muted-foreground flex items-center gap-3 text-[11px] uppercase">
            <span className="bg-border h-px flex-1" />
            or
            <span className="bg-border h-px flex-1" />
          </div>

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
