import { describe, expect, it } from "vitest"
import { generateInputs, prng } from "./inputs"

describe("generateInputs", () => {
  const schema = {
    type: "object",
    required: ["heightMm", "type"],
    properties: {
      heightMm: { type: "number", minimum: 40, maximum: 400 },
      facets: { type: "integer", minimum: 3, maximum: 12 },
      type: { type: "string", enum: ["round", "faceted", "tapered"] },
      units: { type: "string", maxLength: 2 },
      url: { type: "string", format: "uri" },
      nested: { type: "object", properties: { deep: { type: "array", items: { type: "boolean" } } } },
      flag: { type: "boolean" },
    },
  }

  it("is deterministic under a seed and sweeps numbers across their range", () => {
    const a = generateInputs(schema, { runs: 6, seed: 7 })
    const b = generateInputs(schema, { runs: 6, seed: 7 })
    expect(a).toEqual(b)
    const heights = a.map((i) => (i as { heightMm: number }).heightMm)
    expect(heights[0]).toBe(40)
    expect(heights[5]).toBe(400)
    for (const i of a) {
      const v = i as Record<string, unknown>
      expect(v.heightMm).toBeGreaterThanOrEqual(40)
      expect(["round", "faceted", "tapered"]).toContain(v.type)
      if (v.facets !== undefined) expect(Number.isInteger(v.facets)).toBe(true)
      if (v.units !== undefined) expect(String(v.units).length).toBeLessThanOrEqual(2)
      if (v.url !== undefined) expect(String(v.url)).toMatch(/^https:\/\//)
    }
  })

  it("toggles optional keys between runs and keeps required ones", () => {
    const inputs = generateInputs(schema, { runs: 4 }) as Record<string, unknown>[]
    expect(inputs.every((i) => "heightMm" in i && "type" in i)).toBe(true)
    expect(inputs.some((i) => "facets" in i)).toBe(true)
    expect(inputs.some((i) => !("facets" in i))).toBe(true)
  })

  it("recurses into nested objects and arrays to a bounded depth", () => {
    const inputs = generateInputs(schema, { runs: 2 }) as { nested?: { deep?: boolean[] } }[]
    const withNested = inputs.find((i) => i.nested)
    expect(withNested?.nested?.deep?.every((x) => typeof x === "boolean")).toBe(true)
  })

  it("handles empty schemas, enums at the root, and consts", () => {
    expect(generateInputs(undefined, { runs: 2 })).toEqual([{}, {}])
    expect(generateInputs({ enum: ["a", "b"] }, { runs: 3 })).toEqual(["a", "b", "a"])
    expect(generateInputs({ type: "object", properties: { v: { const: 1 } }, required: ["v"] }, { runs: 1 })).toEqual([{ v: 1 }])
  })

  it("prng is stable", () => {
    const r = prng(42)
    expect([r(), r()]).toEqual([prng(42)(), (() => { const q = prng(42); q(); return q() })()])
  })
})
