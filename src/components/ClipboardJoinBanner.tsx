import { useEffect, useState } from "react"
import { KeyRound, Link as LinkIcon, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { feedback } from "@/lib/feedback"
import { startPairingClipboardWatch, type PairingOffer } from "@/lib/pairingOffer"
import { useTimeout } from "@/lib/useTimeout"
import { liveSync } from "@/store/syncClient"

/**
 * The shortcut past the four-step join: an agent gives the potter a code
 * (or a live link) in a chat, they copy it, they come back here — and the
 * app simply asks whether to join that session, instead of making them
 * find the connection button, open Continue on another screen, reveal the
 * code field and paste.
 *
 * Everything about WHEN an offer exists lives in pairingOffer.ts, which
 * never prompts for clipboard permission and never joins anything by
 * itself. This component is the question and the one tap that answers it:
 *
 *  - it asks only when a join could mean something — a tab already live
 *    with another screen is left alone, and this tab's own minted codes
 *    are never offered back to it;
 *  - joining is the same single-use claim the dialog and ?join= links
 *    make, so this device adopts that session's design (one undo step
 *    brings the current one back — said out loud, before the tap).
 */
export function ClipboardJoinBanner() {
  const [offer, setOffer] = useState<PairingOffer | null>(null)
  const [state, setState] = useState<"idle" | "joining" | "joined" | "failed">("idle")
  const dismissLater = useTimeout()

  useEffect(
    () =>
      startPairingClipboardWatch({
        onOffer: (found) => {
          // already live with another screen: this tab has nothing to gain
          // from a second invitation, and joining would leave that session
          if (liveSync.status() === "syncing" && liveSync.peers() > 1) return
          setState("idle")
          setOffer(found)
        },
      }),
    []
  )

  if (!offer) return null

  const dismiss = () => setOffer(null)

  const join = async () => {
    setState("joining")
    const result = await liveSync.joinWithCode(offer.secret)
    if (result.ok) {
      feedback("success")
      setState("joined")
      dismissLater(() => setOffer(null), 3000)
      return
    }
    setState(result.retryable ? "idle" : "failed")
  }

  return (
    <div
      role="status"
      className="rise-in bg-background fixed top-16 right-4 left-4 z-50 rounded-xl border p-4 shadow-lg sm:left-auto sm:w-96"
    >
      <div className="flex items-start gap-3">
        {offer.kind === "link" ? (
          <LinkIcon className="mt-0.5 size-5 shrink-0" />
        ) : (
          <KeyRound className="mt-0.5 size-5 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          {state === "joined" ? (
            <>
              <p className="text-sm font-semibold tracking-tight text-emerald-700 dark:text-emerald-400">
                Joined — this device now follows that session
              </p>
              <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                Every edit here or there appears on both within about a second. One undo step
                brings your previous design back.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold tracking-tight">
                {offer.kind === "link"
                  ? "You copied a live Unfolded link"
                  : "You copied a pairing code"}
              </p>
              <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                Join that session and this device follows the design it holds — edits then sync
                both ways. Your current design stays one undo step away.
              </p>
              <div className="mt-2.5 flex items-center gap-2">
                <code className="bg-muted min-w-0 flex-1 truncate rounded-md px-2.5 py-1.5 font-mono text-sm tracking-widest">
                  {offer.display}
                </code>
                <Button size="sm" onClick={() => void join()} disabled={state === "joining"}>
                  {state === "joining" ? "Joining…" : "Join"}
                </Button>
              </div>
              {state === "failed" && (
                <p className="mt-2 text-xs text-red-600">
                  That one didn&rsquo;t work — codes and links expire after 15 minutes and work
                  once. Ask for a fresh one.
                </p>
              )}
            </>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="text-muted-foreground hover:text-foreground -mt-1 -mr-1 rounded p-1 transition-colors"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  )
}
