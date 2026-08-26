import { useEffect } from "react"
import { useProjectStore } from "@/store/useProjectStore"
import { getModelContext } from "./modelContext"
import { buildTools } from "./tools"

let registered = false

/**
 * Registers the app's WebMCP tools once on mount (module-level guard makes
 * this safe under StrictMode double-mounting).
 */
export function useWebMCP(): void {
  const setAgentStatus = useProjectStore((s) => s.setAgentStatus)

  useEffect(() => {
    const modelContext = getModelContext()
    if (!modelContext) {
      setAgentStatus("unavailable")
      return
    }
    setAgentStatus("native")
    if (registered) return
    registered = true
    for (const tool of buildTools()) {
      modelContext.registerTool(tool)
    }
  }, [setAgentStatus])
}
