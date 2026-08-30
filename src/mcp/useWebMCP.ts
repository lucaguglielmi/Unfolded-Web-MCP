import { useEffect } from "react"
import { useProjectStore } from "@/store/useProjectStore"
import { getModelContextInfo, type ToolDescriptor } from "./modelContext"
import { buildTools } from "./tools"

let registered = false

const FAST_POLL_MS = 500
const FAST_WINDOW_MS = 15_000
const SLOW_POLL_MS = 3_000

/**
 * Registers the app's WebMCP tools and keeps the connection badge honest.
 *
 * Hosts differ wildly in WHEN they expose the API: extension shims attach
 * it shortly after load, but in-app agent browsers (e.g. ChatGPT's) may
 * inject document.modelContext only when the person first engages the
 * agent — possibly minutes in. So we never stop watching: poll fast for
 * the first 15s, then keep a slow heartbeat forever, and also re-check
 * whenever the tab regains focus/visibility (agent UIs often steal focus).
 *
 * Hosts also differ in WHERE (document/navigator/window) and HOW
 * (registerTool per tool, or a single provideContext) — both are handled.
 * Independently of all this, the store flips the badge to "native" the
 * moment any tool actually executes (see recordAgentCall): a tool call is
 * definitive proof an agent is connected, whatever the injection story.
 */
export function useWebMCP(): void {
  const setAgentStatus = useProjectStore((s) => s.setAgentStatus)
  const setAgentApiLocation = useProjectStore((s) => s.setAgentApiLocation)

  useEffect(() => {
    const tryRegister = (): boolean => {
      const found = getModelContextInfo()
      if (!found) return false
      if (!registered) {
        try {
          const tools = buildTools()
          if (typeof found.ctx.registerTool === "function") {
            for (const tool of tools) found.ctx.registerTool(tool)
          } else if (typeof found.ctx.provideContext === "function") {
            found.ctx.provideContext({ tools })
          } else {
            return false
          }
          // Manual-testing hook: in a browser with the WebMCP flag but no
          // agent attached (e.g. Chrome mobile via chrome://inspect), the
          // DevTools console can drive the tools directly:
          //   __unfoldedTools.describe_project.execute({})
          ;(window as Window & { __unfoldedTools?: Record<string, ToolDescriptor> }).__unfoldedTools =
            Object.fromEntries(tools.map((t) => [t.name, t]))
          registered = true
        } catch (error) {
          // don't claim "connected" on a partial registration
          console.warn("WebMCP tool registration failed:", error)
          return false
        }
      }
      setAgentStatus("native")
      setAgentApiLocation(found.location)
      return true
    }

    if (tryRegister()) return

    // No downgrade here: the store already defaults to "unavailable", and a
    // boot-detected "chatgpt" (agent-minted link) state must survive until
    // direct registration upgrades it to "native".
    const startedAt = performance.now()
    let timer = window.setInterval(() => {
      // hidden tabs skip the poll — the visibilitychange recheck below
      // fires the moment the tab comes back, so nothing is missed
      if (document.hidden) return
      if (tryRegister()) {
        window.clearInterval(timer)
        return
      }
      if (performance.now() - startedAt > FAST_WINDOW_MS) {
        window.clearInterval(timer)
        // late injection is normal for agent browsers — keep watching, slowly
        timer = window.setInterval(() => {
          if (!document.hidden && tryRegister()) window.clearInterval(timer)
        }, SLOW_POLL_MS)
      }
    }, FAST_POLL_MS)

    const recheck = () => {
      tryRegister()
    }
    document.addEventListener("visibilitychange", recheck)
    window.addEventListener("focus", recheck)

    return () => {
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", recheck)
      window.removeEventListener("focus", recheck)
    }
  }, [setAgentStatus, setAgentApiLocation])
}
