/**
 * Typings for the WebMCP browser API, modeled on the current draft
 * (https://webmachinelearning.github.io/webmcp/ — Draft Community Group
 * Report): `document.modelContext` is the standards path,
 * `registerTool(tool, { signal })` returns a promise and takes an abort
 * signal, and tool `execute` receives an options bag carrying the host's
 * cancellation signal. Kept as a minimal local declaration (rather than a
 * published types package) so it models exactly the surface this app
 * uses, no more.
 *
 * LEGACY COMPATIBILITY — not part of the current standard: some earlier
 * hosts exposed the registry on `navigator.modelContext` or
 * `window.modelContext`, offered a single `provideContext({tools})`
 * instead of `registerTool`, or returned an `unregister()` handle. Those
 * shapes are accepted by the detection below purely so older hosts keep
 * working; nothing in the app depends on them.
 */

export interface TextContent {
  type: "text"
  text: string
}

export interface ImageContent {
  type: "image"
  /** base64-encoded image bytes (no data: prefix) */
  data: string
  mimeType: string
}

export type ToolContent = TextContent | ImageContent

export interface ToolResult {
  content: ToolContent[]
  isError?: boolean
}

/** options the host passes into a tool execution (current draft) */
export interface ToolExecuteOptions {
  /** aborted when the host cancels the call — stop work, commit nothing after */
  signal?: AbortSignal
}

export interface ToolDescriptor {
  name: string
  /** human-readable title — top-level per the current draft */
  title?: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: {
    /** duplicated here for MCP-style hosts that read the nested form */
    title?: string
    /** tool reads state only, never mutates */
    readOnlyHint?: boolean
    /** result may contain third-party/untrusted content */
    untrustedContentHint?: boolean
  }
  execute: (input: unknown, options?: ToolExecuteOptions) => Promise<ToolResult>
}

/** options for registerTool (current draft): abort unregisters the tool */
export interface RegisterToolOptions {
  signal?: AbortSignal
}

export interface ModelContext {
  /** current draft: async; await it. (Legacy hosts may return undefined —
      awaiting that is harmless, which is what keeps them working.) */
  registerTool?: (tool: ToolDescriptor, options?: RegisterToolOptions) => void | Promise<unknown>
  /** LEGACY: single-call registration for hosts without registerTool */
  provideContext?: (context: { tools: ToolDescriptor[] }) => void
}

declare global {
  interface Document {
    modelContext?: ModelContext
  }
  interface Navigator {
    modelContext?: ModelContext
  }
  interface Window {
    modelContext?: ModelContext
  }
}

export interface ModelContextInfo {
  ctx: ModelContext
  /** where the host exposed the API — shown on /webmcp for debugging */
  location: "document.modelContext" | "navigator.modelContext" | "window.modelContext"
}

export function getModelContextInfo(): ModelContextInfo | undefined {
  // standards path first; navigator/window are legacy host compatibility
  if (typeof document !== "undefined" && document.modelContext) {
    return { ctx: document.modelContext, location: "document.modelContext" }
  }
  if (typeof navigator !== "undefined" && navigator.modelContext) {
    return { ctx: navigator.modelContext, location: "navigator.modelContext" }
  }
  if (typeof window !== "undefined" && window.modelContext) {
    return { ctx: window.modelContext, location: "window.modelContext" }
  }
  return undefined
}

export function textResult(text: string, isError = false): ToolResult {
  return { content: [{ type: "text", text }], isError }
}
