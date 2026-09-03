/**
 * The short runtime strings the core needs synchronously: status phases
 * with their hints, and the report tool's views. The full documentation
 * tables live in ./docs and load on demand.
 */
import type { ProfilerPhase } from "../index"

/** What each view of the report tool returns and what it costs to read. */
export const REPORT_VIEWS = {
  summary: "the split and one row per tool; under 1 KB",
  tools: "summary plus the full per-tool aggregates",
  spans: "tools plus the newest spans (limit, default 50; tool and since filters); the heaviest view",
} as const

/** A view name of the report tool. */
export type ReportView = keyof typeof REPORT_VIEWS

/** The sentence and next steps for each status phase. */
export const PHASE_HINTS: Record<ProfilerPhase, { message: string; hints: string[] }> = {
  inactive: {
    message: "profiler is inactive: this is the server-side no-op, or attachProfiler() was never called",
    hints: ["call attachProfiler() in the browser, before tool registration starts"],
  },
  "no-host": {
    message: "attached; no modelContext registry found yet on document, navigator, or window",
    hints: [
      "agent browsers inject the registry late, sometimes minutes in: keep the tab open and use the agent",
      "check the browser: Chrome/Edge need the WebMCP origin trial or flag; ChatGPT desktop has it built in",
      "no host at all? install a fake one for a dry run: import { createFakeHost } from \"webmcp-profiler/testing\"",
    ],
  },
  "host-found": {
    message: "registry found; the site has not registered any tools on it yet",
    hints: [
      "the site's registration may poll: wait one heartbeat",
      "registered before the profiler loaded? retrofit the site's own registry: __webmcpPerf.instrument(window.__myTools)",
    ],
  },
  "tools-registered": {
    message: "tools are wrapped; waiting for the first call",
    hints: [
      "drive a tool from the agent, or call it yourself from the console: tool.execute({ ... })",
      "no agent? the bench drives every read-only tool: npx webmcp-profiler bench <url>",
    ],
  },
  measuring: { message: "measuring", hints: ["__webmcpPerf.summary() for the split; .report() for the document; .overlay() for the panel"] },
  detached: { message: "detached: originals restored, nothing observed", hints: ["attachProfiler() again to resume"] },
}

