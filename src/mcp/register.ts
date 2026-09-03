import type { ModelContext, ToolDescriptor } from "./modelContext"

/**
 * The all-or-nothing registration engine, kept free
 * of React and DOM so it is unit-testable against fake hosts that resolve
 * slowly, reject mid-set, or ignore signals entirely.
 *
 * Contract:
 *  - every `registerTool` call is issued synchronously, in order (hosts
 *    that list tools by registration order keep the order), and awaited
 *    together — a host whose registration is a real round trip pays one
 *    latency for the whole set, not one per tool. Each call is
 *    defensively wrapped in Promise.resolve: a legacy host returning
 *    undefined awaits harmlessly;
 *  - success means ALL tools resolved; the caller may only then report an
 *    active connection;
 *  - any rejection aborts the provided controller's signal, which a
 *    current-draft host uses to remove the tools already registered —
 *    leaving the host clean for one retry without duplicate names;
 *  - an abort before the set is issued registers nothing; an abort while
 *    the set is in flight reports failure and the signal removes whatever
 *    landed;
 *  - legacy hosts without registerTool fall back to provideContext
 *    (synchronous, single call, nothing to await or abort).
 */
export async function registerToolSet(
  ctx: ModelContext,
  tools: ToolDescriptor[],
  controller: AbortController
): Promise<boolean> {
  if (typeof ctx.registerTool === "function") {
    if (controller.signal.aborted) return false
    const registerTool = ctx.registerTool
    try {
      const pending = tools.map((tool) =>
        Promise.resolve(registerTool(tool, { signal: controller.signal }))
      )
      await Promise.all(pending)
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
