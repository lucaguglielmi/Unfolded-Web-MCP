import { useSyncExternalStore } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { liveSync } from "@/store/syncClient"

/**
 * Live-sync presence, deliberately SEPARATE from the WebMCP pill (whose
 * three-state semantics are frozen — pairing is not a fourth agent state).
 * Same honesty rule as the pill: every state shown is something the socket
 * confirmed. Nothing renders while the tab is unpaired, so the header is
 * byte-for-byte today's header until pairing is actually used.
 *
 * - grey "syncing…": this tab wants its session but the link isn't live
 * - grey "paired": connected, but no other device is in the session
 * - green "n devices": the session has live peers — edits flow both ways
 */
export function SyncBadge() {
  const snapshot = useSyncExternalStore(
    (cb) => liveSync.subscribe(cb),
    () => `${liveSync.status()}:${liveSync.peers()}:${liveSync.everPeered()}`
  )
  const [status, peersRaw, everPeeredRaw] = snapshot.split(":")
  const peers = Number(peersRaw)
  const everPeered = everPeeredRaw === "true"

  // "paired" is a claim about another device — never shown unless one has
  // actually been in the session. A freshly minted, never-claimed session
  // (an agent calling start_pairing, an unused code) shows nothing here;
  // it also forgets itself once the code's lifetime passes.
  if (status === "off" || !everPeered) return null

  const live = status === "syncing" && peers > 1
  const label = status === "connecting" ? "syncing…" : live ? `${peers} devices` : "paired"
  const tooltip =
    status === "connecting"
      ? "This device is paired to a live session and reconnecting to it. Edits made meanwhile are kept and sent once the link is back."
      : live
        ? `${peers} devices are in this live session — every edit here, or by an agent on any of them, appears on all within about a second.`
        : "This device is paired to a live session, but no other device is connected right now. Pair one via the two-screens icon."

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={`Live sync: ${label}`}
          className="border-border text-muted-foreground inline-flex shrink-0 cursor-default items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs whitespace-nowrap"
        >
          <span
            className={cn(
              "inline-flex size-2 rounded-full",
              live ? "bg-emerald-500" : "bg-stone-300"
            )}
          />
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 leading-relaxed">{tooltip}</TooltipContent>
    </Tooltip>
  )
}
