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
 * Join tokens: the URL-borne sibling of a code (docs/live-sync-spec.md v3).
 * 24 crypto-random bytes as base64url (~128 bits — guessing is void, so no
 * process protections needed beyond the shared rate limits), the same
 * 15-minute TTL as codes (both raised on 2026-09-02: codes from 5, tokens
 * from 10), still single use and burned on claim. Never the sid.
 */
export const TOKEN_TTL_MS = 15 * 60_000
const TOKEN_BYTES = 24
const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/

/** claims allowed per IP per minute */
const PER_IP_PER_MINUTE = 10
/** claims allowed globally per second */
const GLOBAL_PER_SECOND = 100

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
  private readonly random: () => number

  constructor(restored?: PairingSnapshot, random: () => number = Math.random) {
    this.random = random
    if (restored) this.codes = new Map(restored.codes)
  }

  mint(sid: string, now: number): MintResult {
    this.sweep(now)
    let code: string
    do {
      code = Array.from(
        { length: CODE_LENGTH },
        () => CODE_ALPHABET[Math.floor(this.random() * CODE_ALPHABET.length)]
      ).join("")
    } while (this.codes.has(code))
    const expiresAt = now + CODE_TTL_MS
    this.codes.set(code, { sid, expiresAt })
    return { code, expiresAt }
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
    if (this.globalClaims.length >= GLOBAL_PER_SECOND) return { ok: false, reason: "rate_limited" }
    this.globalClaims.push(now)
    const perIp = (this.ipClaims.get(ip) ?? []).filter((t) => now - t < 60_000)
    if (perIp.length >= PER_IP_PER_MINUTE) return { ok: false, reason: "rate_limited" }
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
