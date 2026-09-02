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

/**
 * Result contract version (hardening spec 9.3). Bump when the shape of
 * `structuredContent` changes incompatibly; the contract is written up in
 * docs/performance-report.md ("Structured results").
 */
export const TOOL_RESULT_CONTRACT = "tool-result/1"

/**
 * The machine-readable half of every tool result. `ok` mirrors
 * `!isError`; `message` is the sentence the text content opens with;
 * tools that report the design carry the describeState() snapshot under
 * `state` (the unchanged state on failures) and its `warnings` when
 * there are any. Other tools add their own fields beside ok/message
 * (the handoff link, the template summary, the export page count).
 */
export interface StructuredResult {
  ok: boolean
  message: string
  [field: string]: unknown
}

/**
 * The result envelope. The draft's IDL is
 * `callback ToolExecuteCallback = Promise<any> (object inputObject,
 * ToolExecuteCallbackOptions options)` and its "tool execute steps" hand
 * the host the fulfilled value after "serializing a JavaScript value to a
 * JSON string" — any JSON-serializable value, with no result envelope of
 * the draft's own (ModelContextTool `execute` member and the tool execute
 * steps, https://webmachinelearning.github.io/webmcp/). Hosts in the wild
 * (ChatGPT's agent browser, MCP-B) read the MCP call-result envelope, so
 * `content` + `isError` stay exactly as they are and the structured object
 * rides beside them under MCP's own name for it, `structuredContent`.
 * Additive: a host that ignores the field loses nothing.
 */
export interface ToolResult {
  content: ToolContent[]
  isError?: boolean
  structuredContent?: StructuredResult
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

export function textResult(
  text: string,
  isError = false,
  structuredContent?: StructuredResult
): ToolResult {
  const result: ToolResult = { content: [{ type: "text", text }], isError }
  if (structuredContent) result.structuredContent = structuredContent
  return result
}
