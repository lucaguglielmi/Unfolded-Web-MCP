import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useDesignHref } from "@/lib/useStudioHref"
import { useProjectStore, type AgentStatus } from "@/store/useProjectStore"

/**
 * The WebMCP status pill, with three honest states:
 *
 * - "WebMCP active" (pulsing green): the API is available in THIS tab and
 *   the tools registered — human and agent share one live session.
 * - "Connected via ChatGPT" (solid green, no pulse): this tab has no direct
 *   WebMCP, but the design arrived through an agent-minted link — the
 *   explicit signal that it is open in the internal browser of a ChatGPT
 *   conversation. Never inferred from user agent / referrer / in-app-ness.
 * - "WebMCP" (grey): neither could be confirmed — the pill just names the
 *   capability without shouting about its absence; the tooltip explains.
 *
 * Links to /webmcp, the page that explains the whole story.
 */

const STATUS: Record<
  AgentStatus,
  { label: string; tooltip: string; dot: string; ping: boolean }
> = {
  native: {
    label: "WebMCP active",
    tooltip:
      "This page is directly connected to the agent through WebMCP. Changes made by you or the agent are visible in the same live session.",
    dot: "bg-emerald-500",
    ping: true,
  },
  chatgpt: {
    label: "Connected via ChatGPT",
    tooltip:
      "This design arrived through a link your agent minted in ChatGPT. Agent links are live invitations: tapping one makes this tab follow the agent's session both ways — your edits here show up in its next read. The presence badge beside this pill shows the live status; if it's missing, ask the agent for its latest link.",
    dot: "bg-emerald-500",
    ping: false,
  },
  unavailable: {
    label: "WebMCP",
    tooltip:
      "WebMCP is not available in this browser tab. Ask ChatGPT to open Unfolded in its internal browser, or use the built-in browser in the ChatGPT desktop app.",
    dot: "bg-stone-300",
    ping: false,
  },
}

export function AgentBadge() {
  const agentStatus = useProjectStore((s) => s.agentStatus)
  const lastAgentCall = useProjectStore((s) => s.lastAgentCall)
  const status = STATUS[agentStatus]
  const webmcpHref = useDesignHref("/webmcp")

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {lastAgentCall && (
        <span className="text-muted-foreground hidden min-w-0 truncate text-xs sm:inline">
          last agent call: <code className="text-foreground/80">{lastAgentCall.tool}</code>
        </span>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href={webmcpHref}
            aria-label={`${status.label} — learn more`}
            className="border-border text-foreground hover:bg-accent inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors"
          >
            <span className="relative flex size-2">
              {status.ping && (
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              )}
              <span className={cn("relative inline-flex size-2 rounded-full", status.dot)} />
            </span>
            {status.label}
          </a>
        </TooltipTrigger>
        <TooltipContent className="max-w-72 leading-relaxed">{status.tooltip}</TooltipContent>
      </Tooltip>
    </div>
  )
}
