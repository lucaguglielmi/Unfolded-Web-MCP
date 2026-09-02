import { readFileSync } from "node:fs"
import Ajv2020 from "ajv/dist/2020"
import { describe, expect, it } from "vitest"
import { Collector } from "./core/collector"

const schema = JSON.parse(readFileSync(new URL("../schema/report.v2.json", import.meta.url), "utf8"))

describe("schema/report.v2.json", () => {
  it("validates a real report, including an error span and an internal tool", () => {
    const ajv = new Ajv2020({ strict: true, validateFormats: false })
    const validate = ajv.compile(schema)
    const c = new Collector()
    c.hostFound("document")
    c.toolRegistered("demo", 120)
    c.toolRegistered("get_perf_report", 400, true)
    c.record({ tool: "demo", invokedAt: 0, settledAt: 5, wallMs: 5, blockingMs: 0, inputBytes: 2, resultBytes: 40, contentTypes: { text: 1 }, imageBytes: 0, estInputTokens: 1, estTextTokens: 10, estImageTokens: 0, estTokens: 11, isError: false, error: null, serializable: true })
    c.record({ tool: "demo", invokedAt: 100, settledAt: 105, wallMs: 5, blockingMs: 0, inputBytes: 2, resultBytes: 0, contentTypes: {}, imageBytes: 0, estInputTokens: 1, estTextTokens: 0, estImageTokens: 0, estTokens: 1, isError: true, error: "nope", serializable: true })
    const report = JSON.parse(JSON.stringify(c.report()))
    const ok = validate(report)
    expect(validate.errors ?? []).toEqual([])
    expect(ok).toBe(true)
    report.spans[0].extra = 1
    expect(validate(report)).toBe(false)
  })
})
