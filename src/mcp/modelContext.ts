/**
 * Minimal typings for the WebMCP browser API (document.modelContext).
 * Available natively in ChatGPT's in-app browser, and in Chrome behind
 * chrome://flags/#enable-webmcp-testing
 */

export interface ToolContent {
  type: "text"
  text: string
}

export interface ToolResult {
  content: ToolContent[]
  isError?: boolean
}

export interface ToolDescriptor {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: {
    readOnlyHint?: boolean
    title?: string
  }
  execute: (input: unknown) => Promise<ToolResult>
}

export interface ModelContext {
  registerTool: (tool: ToolDescriptor) => unknown
  provideContext?: (context: { tools: ToolDescriptor[] }) => void
}

declare global {
  interface Document {
    modelContext?: ModelContext
  }
}

export function getModelContext(): ModelContext | undefined {
  if (typeof document === "undefined") return undefined
  return document.modelContext
}

export function textResult(text: string, isError = false): ToolResult {
  return { content: [{ type: "text", text }], isError }
}
