import { useEffect } from "react"
import { useProjectStore } from "@/store/useProjectStore"
import { startHostWatch } from "./hostWatch"
import { getModelContextInfo, type ModelContext, type ToolDescriptor } from "./modelContext"
import { registerToolSet } from "./register"
import { buildTools } from "./tools"

/**
 * Registration lifecycle state, module-scoped so it survives React
 * StrictMode's dev double-mount and is shared by every poll/focus/
 * visibility re-check:
 *
 *  - `active` is the registry we successfully registered ALL tools on,
 *    with the AbortController whose signal those registrations carry —
 *    aborting it asks a current-draft host to unregister the set.
 *  - `attemptInFlight` is the concurrency guard: registration is async
 *    now, and two overlapping attempts (a poll tick racing a focus
 *    re-check) must never interleave their registerTool calls.
 */
let active: { ctx: ModelContext; controller: AbortController } | null = null
let attemptInFlight = false

/**
 * Registers the app's WebMCP tools and keeps the connection state honest.
 *
 * The watch (hostWatch.ts) looks for a host every 500 ms for the life of
 * the tab while visible, every 3 s while hidden, and immediately on
 * focus/visibility — hosts inject the API at wildly different times,
 * and the one that matters most (ChatGPT's in-app browser) may do so
 * minutes in. The heartbeat also watches for the HOST REPLACING the
 * registry object: a changed identity aborts the old registration set
 * and registers cleanly against the new context.
 *
 * Registration follows the current draft: every registerTool call is
 * awaited (the whole set in parallel), the set is all-or-nothing under
 * one AbortController, and the connection is reported active only after
 * the last registration resolves. Legacy hosts (navigator/window
 * locations, provideContext, void returns) are handled by the
 * compatibility layer in modelContext.ts / register.ts. Independently of
 * all this, the store flips the badge to "native" the moment any tool
 * actually executes (recordAgentCall): a tool call is definitive proof of
 * a connection.
 */
export function useWebMCP(): void {
  const setAgentStatus = useProjectStore((s) => s.setAgentStatus)
  const setAgentApiLocation = useProjectStore((s) => s.setAgentApiLocation)

  useEffect(() => {
    let disposed = false

    const attempt = async (): Promise<boolean> => {
      const found = getModelContextInfo()
      if (!found) return false

      if (active?.ctx === found.ctx) {
        // registered on this very registry — just keep the badge honest
        setAgentStatus("native")
        setAgentApiLocation(found.location)
        return true
      }

      if (attemptInFlight) return false
      attemptInFlight = true
      try {
        // the host swapped the registry out from under us: abort the old
        // set (unregisters on signal-aware hosts) and register fresh
        if (active) {
          active.controller.abort()
          active = null
        }

        const controller = new AbortController()
        const tools = buildTools()
        const ok = await registerToolSet(found.ctx, tools, controller)
        if (!ok || disposed) {
          controller.abort()
          return false
        }

        active = { ctx: found.ctx, controller }
        // Manual-testing hook: in a browser with the WebMCP flag but no
        // agent attached (e.g. Chrome mobile via chrome://inspect), the
        // DevTools console can drive the tools directly:
        //   __unfoldedTools.describe_project.execute({})
        ;(window as Window & { __unfoldedTools?: Record<string, ToolDescriptor> }).__unfoldedTools =
          Object.fromEntries(tools.map((t) => [t.name, t]))
        setAgentStatus("native")
        setAgentApiLocation(found.location)
        return true
      } catch (error) {
        // don't claim "connected" on a partial registration; the watcher
        // below stays eligible to retry against a clean host
        console.warn("WebMCP tool registration failed:", error)
        return false
      } finally {
        attemptInFlight = false
      }
    }

    void attempt()

    // No downgrade here: the store already defaults to "unavailable", and a
    // boot-detected "chatgpt" (agent-minted link) state must survive until
    // direct registration upgrades it to "native". The watch never stops:
    // before success it hunts for a host; after success it watches for the
    // host replacing the registry (attempt() is a cheap identity check in
    // the steady state).
    const stopWatch = startHostWatch({ attempt })

    return () => {
      disposed = true
      stopWatch()
      // unmount aborts the registrations exactly once (StrictMode's dev
      // remount simply registers again against the clean host)
      if (active) {
        active.controller.abort()
        active = null
      }
    }
  }, [setAgentStatus, setAgentApiLocation])
}
