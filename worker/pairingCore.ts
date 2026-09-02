/**
 * Pairing codes — the pure table behind the PairingDO, with no Workers
 * APIs so plain vitest can pin it down. A code is a 15-minute, single-use
 * ticket that resolves to a session id (docs/live-sync-spec.md §4). The
 * 30-bit space is protected by process, not entropy: TTL, burn-on-claim,
 * and the rate limits enforced here; misses are uniform (no oracle for
 * "exists but expired").
 */

/** 31 glyphs, nothing ambiguous to read aloud or retype (no I L O 0 1) */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
export const CODE_LENGTH = 6
export const CODE_TTL_MS = 15 * 60_000

/**
 * Glyph indices from the platform CSPRNG, unbiased: 31 does not divide 256,
 * so a plain `byte % 31` would favor the first eight glyphs. Bytes at or
 * above the largest multiple of 31 (248) are thrown away instead of folded
 * back — a ~3% rejection rate, refilled in batches until `count` survive.
 */
const REJECT_FROM = Math.floor(256 / CODE_ALPHABET.length) * CODE_ALPHABET.length
export function cryptoGlyphIndices(count: number): number[] {
  const out: number[] = []
  // a batch is at most 4 KiB per call — plenty over what a code needs, and
  // well under getRandomValues' 64 KiB cap for the bulk draws in tests
  const buf = new Uint8Array(Math.min(count * 2, 4096))
  while (out.length < count) {
    crypto.getRandomValues(buf)
    for (const b of buf) {
      if (b >= REJECT_FROM) continue
      out.push(b % CODE_ALPHABET.length)
      if (out.length === count) break
    }
  }
  return out
}

/**
 * Join tokens: the URL-borne sibling of a code (docs/live-sync-spec.md v3).
 * 24 crypto-random bytes as base64url (~128 bits — guessing is void, so no
 * process protections needed beyond the shared rate limits), the same
 * 15-minute TTL as codes (both raised: codes from 5 minutes, tokens
 * from 10), still single use and burned on claim. Never the sid.
 */
export const TOKEN_TTL_MS = 15 * 60_000
const TOKEN_BYTES = 24
const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/

/** claims allowed per IP per minute (production value) */
export const DEFAULT_PER_IP_PER_MINUTE = 10
/** claims allowed globally per second (production value) */
export const DEFAULT_GLOBAL_PER_SECOND = 100

/**
 * Both limits are constructor options so a local test run — where every
 * Playwright context shares one IP — can raise the per-IP one via the
 * PAIR_CLAIMS_PER_IP_PER_MINUTE var (e2e/pairing.mjs). Production sets
 * no vars (wrangler.jsonc) and keeps the defaults.
 */
export interface PairingLimits {
  perIpPerMinute?: number
  globalPerSecond?: number
}

/**
 * A limit read from an env var: a positive integer string, else the
 * default — so an unset, empty, or malformed value can only ever leave
 * the production limit in place.
 */
export function parseClaimLimit(raw: unknown, fallback: number): number {
  if (typeof raw !== "string" || !/^\d+$/.test(raw.trim())) return fallback
  const n = Number(raw.trim())
  return Number.isSafeInteger(n) && n > 0 ? n : fallback
}

const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`)

/** uppercase and strip separators/whitespace; null unless exactly 6 alphabet glyphs remain */
export function normalizeCode(raw: string): string | null {
  const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, "")
  return CODE_RE.test(code) ? code : null
}

/** grouped for reading aloud: K7F3QP -> K7F-3QP */
export function formatCode(code: string): string {
  return `${code.slice(0, 3)}-${code.slice(3)}`
}

export interface MintResult {
  code: string
  expiresAt: number
}

export interface MintTokenResult {
  token: string
  expiresAt: number
}

export type ClaimResult =
  | { ok: true; sid: string }
  /** invalid covers unknown, expired, and already-used alike — uniform on purpose */
  | { ok: false; reason: "invalid" | "rate_limited" }

interface CodeRecord {
  sid: string
  expiresAt: number
}

export interface PairingSnapshot {
  codes: [string, CodeRecord][]
}

export class PairingCore {
  private codes = new Map<string, CodeRecord>()
  private globalClaims: number[] = []
  private ipClaims = new Map<string, number[]>()
  /** test seam only: a [0,1) source that replaces the CSPRNG for rigged codes */
  private readonly random: (() => number) | null
  private readonly perIpPerMinute: number
  private readonly globalPerSecond: number

  constructor(restored?: PairingSnapshot, random?: () => number, limits: PairingLimits = {}) {
    this.random = random ?? null
    this.perIpPerMinute = limits.perIpPerMinute ?? DEFAULT_PER_IP_PER_MINUTE
    this.globalPerSecond = limits.globalPerSecond ?? DEFAULT_GLOBAL_PER_SECOND
    if (restored) this.codes = new Map(restored.codes)
  }

  mint(sid: string, now: number): MintResult {
    this.sweep(now)
    let code: string
    do {
      code = this.glyphIndices()
        .map((i) => CODE_ALPHABET[i])
        .join("")
    } while (this.codes.has(code))
    const expiresAt = now + CODE_TTL_MS
    this.codes.set(code, { sid, expiresAt })
    return { code, expiresAt }
  }

  /** production: crypto.getRandomValues, unbiased; tests may inject a rigged source */
  private glyphIndices(): number[] {
    const rng = this.random
    if (!rng) return cryptoGlyphIndices(CODE_LENGTH)
    return Array.from({ length: CODE_LENGTH }, () => Math.floor(rng() * CODE_ALPHABET.length))
  }

  mintToken(sid: string, now: number): MintTokenResult {
    this.sweep(now)
    const bytes = new Uint8Array(TOKEN_BYTES)
    crypto.getRandomValues(bytes)
    let binary = ""
    for (const b of bytes) binary += String.fromCharCode(b)
    const token = btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")
    const expiresAt = now + TOKEN_TTL_MS
    this.codes.set(token, { sid, expiresAt })
    return { token, expiresAt }
  }

  claim(rawCode: string, ip: string, now: number): ClaimResult {
    // throttle before touching the table, so probing is bounded whatever
    // is probed
    this.globalClaims = this.globalClaims.filter((t) => now - t < 1_000)
    if (this.globalClaims.length >= this.globalPerSecond) return { ok: false, reason: "rate_limited" }
    this.globalClaims.push(now)
    const perIp = (this.ipClaims.get(ip) ?? []).filter((t) => now - t < 60_000)
    if (perIp.length >= this.perIpPerMinute) return { ok: false, reason: "rate_limited" }
    perIp.push(now)
    this.ipClaims.set(ip, perIp)

    // a claim is either a 6-glyph code (normalized) or a join token
    // (matched verbatim) — one table, shape-discriminated, uniform misses
    const code = normalizeCode(rawCode)
    const key = code ?? (TOKEN_RE.test(rawCode.trim()) ? rawCode.trim() : null)
    if (!key) return { ok: false, reason: "invalid" }
    const record = this.codes.get(key)
    if (!record || record.expiresAt <= now) return { ok: false, reason: "invalid" }
    this.codes.delete(key) // single use
    return { ok: true, sid: record.sid }
  }

  /** drop expired codes; returns whether anything changed (worth persisting) */
  sweep(now: number): boolean {
    let changed = false
    for (const [code, record] of this.codes) {
      if (record.expiresAt <= now) {
        this.codes.delete(code)
        changed = true
      }
    }
    return changed
  }

  /** earliest expiry among live codes — when the DO's sweep alarm should fire */
  nextExpiry(): number | null {
    let next: number | null = null
    for (const { expiresAt } of this.codes.values()) {
      if (next === null || expiresAt < next) next = expiresAt
    }
    return next
  }

  snapshot(): PairingSnapshot {
    return { codes: [...this.codes.entries()] }
  }
}
