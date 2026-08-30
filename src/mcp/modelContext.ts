/**
 * Minimal typings for the WebMCP browser API. ChatGPT's in-app browser
 * exposes it as document.modelContext; the webmachinelearning/webmcp
 * proposal (Chrome behind chrome://flags/#enable-webmcp-testing) has also
 * hung it off navigator.modelContext — we accept either, preferring
 * document.
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

export interface ToolDescriptor {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: {
    title?: string
    /** tool reads state only, never mutates */
    readOnlyHint?: boolean
    /** tool may overwrite state the user cares about */
    destructiveHint?: boolean
    /** calling twice with the same input equals calling once */
    idempotentHint?: boolean
    /** tool reaches outside the page (network, external services) */
    openWorldHint?: boolean
  }
  execute: (input: unknown) => Promise<ToolResult>
}

/** registerTool may return a handle with unregister() (per the proposal) */
export interface ToolRegistration {
  unregister?: () => void
}

export interface ModelContext {
  registerTool?: (tool: ToolDescriptor) => ToolRegistration | unknown
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
