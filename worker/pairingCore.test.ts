import { afterEach, describe, expect, it, vi } from "vitest"
import {
  cryptoGlyphIndices,
  formatCode,
  normalizeCode,
  CODE_ALPHABET,
  CODE_LENGTH,
  CODE_TTL_MS,
  TOKEN_TTL_MS,
  DEFAULT_GLOBAL_PER_SECOND,
  DEFAULT_PER_IP_PER_MINUTE,
  PairingCore,
  parseClaimLimit,
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

  it("takes both claim limits as constructor options, defaults unchanged", () => {
    expect(DEFAULT_PER_IP_PER_MINUTE).toBe(10)
    expect(DEFAULT_GLOBAL_PER_SECOND).toBe(100)
    const core = new PairingCore(undefined, undefined, { perIpPerMinute: 2, globalPerSecond: 3 })
    expect(core.claim("AAAAAA", "ip1", 0)).toEqual({ ok: false, reason: "invalid" })
    expect(core.claim("AAAAAA", "ip1", 1)).toEqual({ ok: false, reason: "invalid" })
    expect(core.claim("AAAAAA", "ip1", 2)).toEqual({ ok: false, reason: "rate_limited" })
    // the global cap counts every claim, throttled or not
    expect(core.claim("AAAAAA", "ip2", 3)).toEqual({ ok: false, reason: "rate_limited" })
    // a raised per-IP limit lets one address claim well past the default
    const roomy = new PairingCore(undefined, undefined, { perIpPerMinute: 1000 })
    for (let i = 0; i < 50; i++) {
      expect(core.claim("AAAAAA", "ip", 10_000 + i).ok).toBe(false)
      expect(roomy.claim("AAAAAA", "ip", 10_000 + i)).toEqual({ ok: false, reason: "invalid" })
    }
  })

  it("parseClaimLimit: only a positive integer string overrides the default", () => {
    expect(parseClaimLimit("1000", 10)).toBe(1000)
    expect(parseClaimLimit(" 25 ", 10)).toBe(25)
    for (const bad of [undefined, null, "", "abc", "0", "-5", "12.5", "1e3", 1000, true]) {
      expect(parseClaimLimit(bad, 10)).toBe(10)
    }
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

  it("mints URL-safe join tokens with the longer TTL, claimable once", () => {
    const core = new PairingCore()
    const { token, expiresAt } = core.mintToken(SID, 1_000)
    expect(token).toMatch(/^[A-Za-z0-9_-]{20,64}$/)
    expect(expiresAt).toBe(1_000 + TOKEN_TTL_MS)
    expect(core.claim(token, "ip", 2_000)).toEqual({ ok: true, sid: SID })
    expect(core.claim(token, "ip2", 2_001)).toEqual({ ok: false, reason: "invalid" })
  })

  it("tokens expire after their own TTL", () => {
    const core = new PairingCore()
    const { token } = core.mintToken(SID, 0)
    expect(core.claim(token, "ip", TOKEN_TTL_MS)).toEqual({ ok: false, reason: "invalid" })
  })

  it("tokens and codes share one table and survive a snapshot", () => {
    const core = new PairingCore()
    const { code } = core.mint(SID, 0)
    const { token } = core.mintToken("t".repeat(22), 0)
    const revived = new PairingCore(core.snapshot())
    expect(revived.claim(code, "ip", 1)).toEqual({ ok: true, sid: SID })
    expect(revived.claim(token, "ip", 2)).toEqual({ ok: true, sid: "t".repeat(22) })
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

describe("code randomness (crypto, not Math.random)", () => {
  afterEach(() => vi.restoreAllMocks())

  it("draws from crypto.getRandomValues by default, never Math.random", () => {
    const math = vi.spyOn(Math, "random")
    const csprng = vi.spyOn(crypto, "getRandomValues")
    const core = new PairingCore()
    for (let i = 0; i < 20; i++) core.mint(SID, 0)
    expect(math).not.toHaveBeenCalled()
    expect(csprng).toHaveBeenCalled()
  })

  it("keeps the length and stays inside the alphabet over thousands of mints", () => {
    const core = new PairingCore()
    const seen = new Set<string>()
    const counts = new Map<string, number>()
    const N = 5_000
    for (let i = 0; i < N; i++) {
      const { code } = core.mint(SID, 0)
      expect(code).toHaveLength(CODE_LENGTH)
      seen.add(code)
      for (const ch of code) {
        expect(CODE_ALPHABET).toContain(ch)
        counts.set(ch, (counts.get(ch) ?? 0) + 1)
      }
    }
    // no collision (the mint loop retries on one; this also proves the
    // source isn't stuck) and every glyph shows up
    expect(seen.size).toBe(N)
    for (const ch of CODE_ALPHABET) expect(counts.get(ch) ?? 0).toBeGreaterThan(0)
  })

  it("selects glyphs without modulo bias (rejection sampling)", () => {
    // 60k draws: each glyph expects ~1935 (sd ≈ 43). A biased `byte % 31`
    // would give the first eight glyphs 2/256 of draws each and the rest
    // 1/256 — a 2:1 skew — so ±20% is a loose but decisive bound.
    const draws = 60_000
    const counts = new Array<number>(CODE_ALPHABET.length).fill(0)
    for (const i of cryptoGlyphIndices(draws)) {
      expect(i).toBeGreaterThanOrEqual(0)
      expect(i).toBeLessThan(CODE_ALPHABET.length)
      counts[i] = (counts[i] ?? 0) + 1
    }
    const expected = draws / CODE_ALPHABET.length
    for (const n of counts) {
      expect(n).toBeGreaterThan(expected * 0.8)
      expect(n).toBeLessThan(expected * 1.2)
    }
  })

  it("returns exactly the number of indices asked for despite rejections", () => {
    for (const n of [1, 6, 7, 100, 1_000]) expect(cryptoGlyphIndices(n)).toHaveLength(n)
  })
})
