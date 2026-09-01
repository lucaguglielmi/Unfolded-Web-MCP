import type { ModelContext, ToolDescriptor } from "./modelContext"

/**
 * The all-or-nothing registration engine (hardening spec 4.1), kept free
 * of React and DOM so it is unit-testable against fake hosts that resolve
 * slowly, reject mid-set, or ignore signals entirely.
 *
 * Contract:
 *  - every `registerTool` call is awaited (defensively wrapped in
 *    Promise.resolve — a legacy host returning undefined awaits harmlessly);
 *  - success means ALL tools resolved; the caller may only then report an
 *    active connection;
 *  - any rejection aborts the provided controller's signal, which a
 *    current-draft host uses to remove the tools already registered —
 *    leaving the host clean for one retry without duplicate names;
 *  - an abort between tools stops the loop immediately;
 *  - legacy hosts without registerTool fall back to provideContext
 *    (synchronous, single call, nothing to await or abort).
 */
export async function registerToolSet(
  ctx: ModelContext,
  tools: ToolDescriptor[],
  controller: AbortController
): Promise<boolean> {
  if (typeof ctx.registerTool === "function") {
    try {
      for (const tool of tools) {
        if (controller.signal.aborted) return false
        await Promise.resolve(ctx.registerTool(tool, { signal: controller.signal }))
      }
      return !controller.signal.aborted
    } catch (error) {
      // all-or-nothing: tell the host to drop the partial set, then let
      // the caller's watcher retry cleanly
      controller.abort()
      throw error
    }
  }
  if (typeof ctx.provideContext === "function") {
    ctx.provideContext({ tools })
    return !controller.signal.aborted
  }
  return false
}
