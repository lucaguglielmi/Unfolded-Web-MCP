import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useProjectStore } from "@/store/useProjectStore"

/**
 * The WebMCP status pill: always reads "WebMCP", with a status dot that
 * turns green and softly pulses while agent tools are registered in this
 * browser. Links to /webmcp, the page that explains the whole story.
 */
export function AgentBadge() {
  const agentStatus = useProjectStore((s) => s.agentStatus)
  const lastAgentCall = useProjectStore((s) => s.lastAgentCall)
  const active = agentStatus === "native"

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {lastAgentCall && (
        <span className="text-muted-foreground hidden truncate text-xs sm:inline">
          last agent call: <code className="text-foreground/80">{lastAgentCall.tool}</code>
        </span>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href="/webmcp"
            aria-label={active ? "WebMCP active — learn more" : "WebMCP — learn more"}
            className="border-border text-foreground hover:bg-accent inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors"
          >
            <span className="relative flex size-2">
              {active && (
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              )}
              <span
                className={cn(
                  "relative inline-flex size-2 rounded-full",
                  active ? "bg-emerald-500" : "bg-stone-300"
                )}
              />
            </span>
            WebMCP
          </a>
        </TooltipTrigger>
        <TooltipContent className="max-w-72 leading-relaxed">
          {active
            ? "Agent tools are live in this browser: the AI you're chatting with can read and edit this design with you — try asking it to change the shape or export the templates. Click for the full story."
            : "WebMCP lets an AI agent use this app with you. Open this page in ChatGPT's in-app browser, or in Chrome with the WebMCP flag enabled — then just ask for the pot you want. Click to learn how."}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
