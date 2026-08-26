import { Badge } from "@/components/ui/badge"
import { useProjectStore } from "@/store/useProjectStore"

export function AgentBadge() {
  const agentStatus = useProjectStore((s) => s.agentStatus)
  const lastAgentCall = useProjectStore((s) => s.lastAgentCall)

  return (
    <div className="flex items-center gap-2">
      {lastAgentCall && (
        <span className="text-muted-foreground text-xs">
          last agent call: <code>{lastAgentCall.tool}</code>
        </span>
      )}
      {agentStatus === "native" ? (
        <Badge className="bg-emerald-600 text-white">🔌 WebMCP active</Badge>
      ) : (
        <Badge variant="outline">WebMCP not detected</Badge>
      )}
    </div>
  )
}
