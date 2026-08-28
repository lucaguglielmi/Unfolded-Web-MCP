import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useProjectStore } from "@/store/useProjectStore"

export function AgentBadge() {
  const agentStatus = useProjectStore((s) => s.agentStatus)
  const lastAgentCall = useProjectStore((s) => s.lastAgentCall)

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {lastAgentCall && (
        <span className="text-muted-foreground hidden truncate text-xs sm:inline">
          last agent call: <code className="text-foreground/80">{lastAgentCall.tool}</code>
        </span>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          {agentStatus === "native" ? (
            <Badge className="cursor-help bg-emerald-600 text-white">🔌 WebMCP active</Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground cursor-help font-normal">
              WebMCP not detected
            </Badge>
          )}
        </TooltipTrigger>
        <TooltipContent className="max-w-72 leading-relaxed">
          {agentStatus === "native"
            ? "This page registered its editing tools on document.modelContext (WebMCP). An AI agent in your browser can read and edit this design with you — try asking it to change the shape or export the templates."
            : "WebMCP lets an AI agent use this app with you. Open this page in ChatGPT's in-app browser, or in Chrome with chrome://flags/#enable-webmcp-testing enabled."}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
