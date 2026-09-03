// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { buildAgentManifest } from "@/pages/agentManifest"
import { describe as describeProfiler } from "@/profiler/docs"
import { attachProfiler } from "@/profiler/index"
import { profilerTool } from "@/profiler/tool"
import { createFakeHost } from "@/profiler/testing"
import { buildTools } from "./tools"

/**
 * The agent manifest's profiler block is the package's own description
 * (docs/webmcp-profiler-spec.md §9): it cannot drift because it
 * is not written here. The tool the manifest promises is registered while
 * profiling is armed.
 */
describe("profiler manifest", () => {
  afterEach(() => window.__webmcpPerf?.detach())

  it("embeds describe() verbatim and every console method exists on a live profiler", () => {
    const manifest = buildAgentManifest() as { profiler: ReturnType<typeof describeProfiler> }
    expect(manifest.profiler).toEqual(describeProfiler({}, "get_perf_report"))
    const profiler = attachProfiler({ relay: false })
    for (const name of Object.keys(manifest.profiler.console.methods)) expect(profiler).toHaveProperty(name)
    expect(manifest.profiler.tool?.name).toBe("get_perf_report")
  })

  it("registers get_perf_report as the twelfth tool only while profiling is armed", () => {
    expect(buildTools().map((t) => t.name)).not.toContain("get_perf_report")
    const host = createFakeHost({ async: false })
    const profiler = attachProfiler({ relay: false })
    const names = buildTools().map((t) => t.name)
    expect(names[names.length - 1]).toBe("get_perf_report")
    expect(names).toHaveLength(12)
    const registered = buildTools()[11]
    const reference = profilerTool(profiler)
    expect(registered.name).toBe(reference.name)
    expect(registered.annotations?.readOnlyHint).toBe(true)
    expect(registered.description).toBe(reference.description)
    profiler.detach()
    host.uninstall()
  })

  it("documents both pairing mint messages supported by the worker", () => {
    const manifest = buildAgentManifest() as {
      liveSync: { transport: { clientToServer: Record<string, unknown>; serverToClient: Record<string, unknown> } }
    }
    expect(manifest.liveSync.transport.clientToServer).toHaveProperty("mint_token")
    expect(manifest.liveSync.transport.serverToClient).toHaveProperty("token")
  })
})
