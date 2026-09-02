import { useEffect, useState } from "react"
import { Check, Share2 } from "lucide-react"
import { LogoMark } from "@/components/LogoMark"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { feedback } from "@/lib/feedback"
import { shareUrl } from "@/lib/model/shareLink"
import { useTimeout } from "@/lib/useTimeout"
import { useProjectStore } from "@/store/useProjectStore"

/**
 * Share dialog: the design's deep link as a QR (scan with a phone to
 * continue in ChatGPT's browser there) plus one-tap copy. The address bar
 * already tracks the design live (see startShareLinkSync) — this is the
 * way to grab it, especially in in-app browsers that hide the URL bar.
 *
 * Uncontrolled by default (renders its own icon-button trigger, as in the
 * desktop header); pass `open`/`onOpenChange` to control it from elsewhere
 * (the mobile menu), in which case no trigger is rendered.
 */
export function ShareDialog({
  open: controlledOpen,
  onOpenChange,
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
} = {}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : uncontrolledOpen
  const setOpen = (next: boolean) =>
    isControlled ? onOpenChange?.(next) : setUncontrolledOpen(next)
  const [copied, setCopied] = useState(false)
  const [qr, setQr] = useState<string | null>(null)
  const later = useTimeout()

  const form = useProjectStore((s) => s.form)
  const clay = useProjectStore((s) => s.clay)
  const paperSize = useProjectStore((s) => s.paperSize)
  const unit = useProjectStore((s) => s.unit)
  const url = shareUrl(form, clay, paperSize, { unit })

  useEffect(() => {
    if (!open) return
    let cancelled = false
    import("qrcode")
      .then(({ toDataURL }) =>
        // error correction H tolerates the logomark sitting in the middle
        toDataURL(url, {
          margin: 1,
          width: 512,
          errorCorrectionLevel: "H",
          color: { dark: "#1c1917", light: "#ffffff" },
        })
      )
      .then((dataUrl) => {
        if (!cancelled) setQr(dataUrl)
      })
      .catch(() => {
        if (!cancelled) setQr(null)
      })
    return () => {
      cancelled = true
    }
  }, [open, url])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      feedback("success")
      setCopied(true)
      later(() => setCopied(false), 1500)
    } catch {
      // clipboard can be unavailable (permissions, older webviews)
      window.prompt("Copy this link to share the design:", url)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!isControlled && (
        <DialogTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Share this design" title="Share this design">
            <Share2 className="size-4" />
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Share this design</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4">
          {qr && (
            <div className="rise-in relative">
              <img
                src={qr}
                alt="QR code of the design's share link"
                className="size-44 rounded-lg border p-2"
              />
              {/* the logomark lives in the middle — EC level H absorbs it */}
              <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md bg-white px-1.5 py-1">
                <LogoMark className="h-5 w-auto" />
              </span>
            </div>
          )}
          <p className="text-muted-foreground text-center text-xs leading-relaxed">
            This shares a <strong>copy</strong> of the design — safe to post anywhere; it
            never grants access to your live session. Want your other screen to follow
            this design live instead? Use <strong>Continue on another screen</strong> (the
            connection button — the two dots in the header).
          </p>
          {/* break-all + min-w-0: a long unbroken URL must never widen the
              dialog (iOS Safari doesn't zero a nowrap flex item's min-width,
              which pushed the whole column past the screen edge) */}
          <code className="bg-muted text-muted-foreground w-full min-w-0 rounded-md px-3 py-2 text-[11px] leading-relaxed break-all">
            {url}
          </code>
          <Button onClick={copy} className="w-full">
            {copied ? (
              <>
                <Check className="size-4" /> Copied
              </>
            ) : (
              "Copy link"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
