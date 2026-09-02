import { describe, expect, it } from "vitest"
import { originAllowed } from "./originCheck"

const prod = new URL("https://tryunfolded.com/api/pair/claim")
const dev = new URL("http://localhost:8788/api/session/abcdefgh12345678/ws")

describe("originAllowed", () => {
  it("passes requests without an Origin header (non-browser clients)", () => {
    expect(originAllowed(null, prod)).toBe(true)
    expect(originAllowed(null, dev)).toBe(true)
  })

  it("passes the same host, any scheme or port", () => {
    expect(originAllowed("https://tryunfolded.com", prod)).toBe(true)
    expect(originAllowed("http://localhost:8788", dev)).toBe(true)
    expect(originAllowed("http://localhost:4173", dev)).toBe(true) // preview port, same host
  })

  it("rejects cross-site browser origins", () => {
    expect(originAllowed("https://evil.example", prod)).toBe(false)
    expect(originAllowed("https://tryunfolded.com.evil.example", prod)).toBe(false)
    expect(originAllowed("http://localhost:8788", prod)).toBe(false)
  })

  it("rejects opaque and malformed origins", () => {
    expect(originAllowed("null", prod)).toBe(false)
    expect(originAllowed("not a url", prod)).toBe(false)
  })
})
