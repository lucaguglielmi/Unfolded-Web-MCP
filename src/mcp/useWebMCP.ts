import { useEffect } from "react"
import { useProjectStore } from "@/store/useProjectStore"
import { getModelContext } from "./modelContext"
import { buildTools } from "./tools"

let registered = false

const POLL_INTERVAL_MS = 500
const POLL_TIMEOUT_MS = 15_000

/**
 * Registers the app's WebMCP tools. Some environments attach
 * document.modelContext asynchronously (extension content scripts, browser
 * shims), so if it isn't there at mount we poll briefly before giving up.
 * The module-level guard makes registration safe under StrictMode.
 */
export function useWebMCP(): void {
  const setAgentStatus = useProjectStore((s) => s.setAgentStatus)

  useEffect(() => {
    const tryRegister = (): boolean => {
      const modelContext = getModelContext()
      if (!modelContext) return false
      if (!registered) {
        try {
          for (const tool of buildTools()) {
            modelContext.registerTool(tool)
          }
          registered = true
        } catch (error) {
          // don't claim "connected" on a partial registration
          console.warn("WebMCP tool registration failed:", error)
          return false
        }
      }
      setAgentStatus("native")
      return true
    }

    if (tryRegister()) return

    setAgentStatus("unavailable")
    const startedAt = performance.now()
    const timer = window.setInterval(() => {
      if (tryRegister() || performance.now() - startedAt > POLL_TIMEOUT_MS) {
        window.clearInterval(timer)
      }
    }, POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [setAgentStatus])
}
