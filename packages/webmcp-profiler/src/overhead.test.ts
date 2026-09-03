import { describe, expect, it } from "vitest"
import { Collector } from "./core/collector"
import { instrumentTool, type ToolLike } from "./core/interceptor"

const p50 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

async function bench(resultBytes: number, calls: number): Promise<{ raw: number; instrumented: number }> {
  const payload = { content: [{ type: "text", text: "x".repeat(resultBytes) }] }
  const rawTool: ToolLike = { name: "raw", execute: async () => payload }
  const wrappedTool: ToolLike = { name: "wrapped", execute: async () => payload }
  instrumentTool(wrappedTool, { collector: new Collector(50), originals: new Map(), sample: 1, errorPolicy: "message" })
  const time = async (tool: ToolLike) => {
    const durations: number[] = []
    for (let i = 0; i < calls; i++) {
      const t0 = performance.now()
      await tool.execute({ i })
      durations.push(performance.now() - t0)
    }
    return p50(durations)
  }
  await time(rawTool) // warm-up
  await time(wrappedTool)
  return { raw: await time(rawTool), instrumented: await time(wrappedTool) }
}

describe("profiler overhead", () => {
  it("adds under 0.05 ms p50 to a 1 KB call and under 1 ms to a 128 KB call", async () => {
    const small = await bench(1024, 2000)
    const large = await bench(128 * 1024, 200)
    console.info(`overhead p50: 1KB +${(small.instrumented - small.raw).toFixed(4)}ms · 128KB +${(large.instrumented - large.raw).toFixed(4)}ms`)
    expect(small.instrumented - small.raw).toBeLessThan(0.05)
    expect(large.instrumented - large.raw).toBeLessThan(1)
  }, 30_000)
})
