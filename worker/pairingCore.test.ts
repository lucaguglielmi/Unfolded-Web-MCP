import { describe, expect, it } from "vitest"
import {
  formatCode,
  normalizeCode,
  CODE_ALPHABET,
  CODE_TTL_MS,
  PairingCore,
} from "./pairingCore"

const SID = "s".repeat(22)

describe("code normalization", () => {
  it("uppercases and strips separators", () => {
    expect(normalizeCode("k7f-3qp")).toBe("K7F3QP")
    expect(normalizeCode(" K7F 3QP ")).toBe("K7F3QP")
  })

  it("rejects wrong lengths and out-of-alphabet glyphs", () => {
    expect(normalizeCode("K7F3Q")).toBeNull()
    expect(normalizeCode("K7F3QPX")).toBeNull()
    expect(normalizeCode("K7F30P")).toBeNull() // 0 is not in the alphabet
    expect(normalizeCode("K7F3IP")).toBeNull() // neither is I
  })

  it("formats grouped for reading aloud", () => {
    expect(formatCode("K7F3QP")).toBe("K7F-3QP")
  })
})

describe("PairingCore", () => {
  it("mints 6-glyph codes from the unambiguous alphabet", () => {
    const core = new PairingCore()
    const { code, expiresAt } = core.mint(SID, 1_000)
    expect(code).toHaveLength(6)
    for (const ch of code) expect(CODE_ALPHABET).toContain(ch)
    expect(expiresAt).toBe(1_000 + CODE_TTL_MS)
  })

  it("claims exactly once — the second claim is a uniform miss", () => {
    const core = new PairingCore()
    const { code } = core.mint(SID, 0)
    expect(core.claim(code, "ip1", 1_000)).toEqual({ ok: true, sid: SID })
    expect(core.claim(code, "ip2", 1_001)).toEqual({ ok: false, reason: "invalid" })
  })

  it("accepts the human-friendly spelling of a code", () => {
    const core = new PairingCore()
    const { code } = core.mint(SID, 0)
    expect(core.claim(formatCode(code).toLowerCase(), "ip", 1)).toEqual({ ok: true, sid: SID })
  })

  it("expires codes after the TTL, indistinguishably from never-minted", () => {
    const core = new PairingCore()
    const { code } = core.mint(SID, 0)
    expect(core.claim(code, "ip", CODE_TTL_MS)).toEqual({ ok: false, reason: "invalid" })
  })

  it("rate-limits per IP (10/minute)", () => {
    const core = new PairingCore()
    for (let i = 0; i < 10; i++) {
      expect(core.claim("AAAAAA", "ip1", i).ok).toBe(false)
    }
    expect(core.claim("AAAAAA", "ip1", 11)).toEqual({ ok: false, reason: "rate_limited" })
    // another IP is unaffected, and the window slides
    expect(core.claim("AAAAAA", "ip2", 11)).toEqual({ ok: false, reason: "invalid" })
    expect(core.claim("AAAAAA", "ip1", 61_001)).toEqual({ ok: false, reason: "invalid" })
  })

  it("rate-limits globally (100/second)", () => {
    const core = new PairingCore()
    for (let i = 0; i < 100; i++) core.claim("AAAAAA", `ip${i}`, 500)
    expect(core.claim("AAAAAA", "fresh-ip", 500)).toEqual({ ok: false, reason: "rate_limited" })
    expect(core.claim("AAAAAA", "fresh-ip", 1_600).ok).toBe(false) // window slid; miss, not throttle
    expect(core.claim("AAAAAA", "fresh-ip", 1_600)).toEqual({ ok: false, reason: "invalid" })
  })

  it("sweeps expired codes and reports the next expiry for the alarm", () => {
    const core = new PairingCore()
    core.mint(SID, 0)
    const later = core.mint(SID, 60_000)
    expect(core.nextExpiry()).toBe(CODE_TTL_MS)
    expect(core.sweep(CODE_TTL_MS)).toBe(true)
    expect(core.nextExpiry()).toBe(later.expiresAt)
    expect(core.sweep(CODE_TTL_MS + 1)).toBe(false)
  })

  it("round-trips codes through a snapshot (DO restart)", () => {
    const core = new PairingCore()
    const { code } = core.mint(SID, 0)
    const revived = new PairingCore(core.snapshot())
    expect(revived.claim(code, "ip", 1)).toEqual({ ok: true, sid: SID })
  })

  it("never mints a colliding code", () => {
    // a rigged rng that repeats the first code's glyph sequence once
    const seq: number[] = []
    let i = 0
    const rng = () => {
      if (seq.length < 12) {
        const v = seq.length < 6 ? 0.1 : (seq[i % 6] ?? 0.1)
        seq.push(v)
        return v
      }
      i++
      return Math.random()
    }
    const core = new PairingCore(undefined, rng)
    const a = core.mint(SID, 0)
    const b = core.mint(SID, 0)
    expect(a.code).not.toBe(b.code)
  })
})
