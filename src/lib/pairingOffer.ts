import { CODE_ALPHABET, CODE_LENGTH } from "../../worker/pairingCore"

/**
 * "You copied a code — want to join that session?"
 *
 * The agent hands the potter a six-character code (or a live link) in a
 * chat; joining with it means finding the connection button, opening
 * Continue on another screen, revealing the code field, and pasting. This
 * module removes those four steps: when a pairing code or a live link
 * shows up in the clipboard, the app can simply ask.
 *
 * Clipboard access is a permission, so this NEVER prompts:
 *  - a `paste` anywhere on the page needs no permission at all — the text
 *    arrives on the event (the primary path, and the only one Firefox and
 *    Safari give us);
 *  - a silent read on focus happens ONLY where clipboard-read is already
 *    granted; "prompt" and unsupported both read nothing.
 * Nothing is ever joined automatically: this produces an offer, and a
 * person taps it.
 *
 * Detection is deliberately narrow, because a wrong guess costs a
 * pointless banner. A code is recognised in prose only in the grouped form
 * everything in this app emits (UZ7-WR6 — prettyCode, the pairing dialog,
 * the agent's messages), or when the whole clipboard is nothing but the
 * code. The unambiguous alphabet does most of the filtering for free: it
 * has no I, L, O, 0 or 1, so most six-letter English words can't be codes.
 */

/** what /api/pair/claim would be given, plus how to name it in the UI */
export interface PairingOffer {
  kind: "code" | "link"
  /** the claim string: a normalized 6-glyph code, or a URL join token */
  secret: string
  /** what the banner shows: "UZ7-WR6", or the link's host */
  display: string
}

const GLYPH = `[${CODE_ALPHABET}]`
/** the whole clipboard is the code — how the pairing dialog's copy button leaves it */
const BARE_CODE_RE = new RegExp(`^${GLYPH}{${CODE_LENGTH}}$`)
/** the grouped form, anywhere in prose: "Pairing code: UZ7-WR6 — valid 15 minutes" */
const GROUPED_CODE_RE = new RegExp(`(^|[^A-Z0-9])(${GLYPH}{3})[- ](${GLYPH}{3})([^A-Z0-9]|$)`)
/** the joinToken contract (agentManifest.ts): url-safe, 20–64 chars */
const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/
const URL_RE = /https?:\/\/[^\s<>"']+/g
/** a copied article is not worth scanning to the end */
const MAX_SCAN = 20_000

const asCode = (code: string): PairingOffer => ({
  kind: "code",
  secret: code,
  display: `${code.slice(0, 3)}-${code.slice(3)}`,
})

/** the offer hiding in a piece of text, or null — pure, and safe on junk */
export function readPairingOffer(raw: string): PairingOffer | null {
  if (!raw) return null
  const text = raw.length > MAX_SCAN ? raw.slice(0, MAX_SCAN) : raw

  // a live link first: it carries the session in ?join=, and the design
  // params beside it are irrelevant — the joined session sends its own
  // state on welcome, exactly as a boot-time ?join= does (urlSync.ts)
  for (const match of text.match(URL_RE) ?? []) {
    // a link at the end of a sentence keeps the sentence's punctuation
    const cleaned = match.replace(/[.,;:!?)\]}'"]+$/, "")
    let token: string | null = null
    try {
      token = new URL(cleaned).searchParams.get("join")
    } catch {
      continue
    }
    if (token && TOKEN_RE.test(token)) {
      return { kind: "link", secret: token, display: hostOf(cleaned) }
    }
  }

  // codes are case-insensitive (normalizeCode uppercases too); URLs above
  // were read from the original text, where token case still mattered
  const upper = text.toUpperCase()
  const trimmed = upper.trim()
  if (BARE_CODE_RE.test(trimmed)) return asCode(trimmed)
  const grouped = GROUPED_CODE_RE.exec(upper)
  return grouped ? asCode(`${grouped[2]}${grouped[3]}`) : null
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/* ------------------------------------------------------------------ */
/* codes this tab minted — never offer the potter their own session    */
/* ------------------------------------------------------------------ */

/**
 * Every code and token this tab mints is remembered here (syncClient does
 * it for all of them), for one honest reason: claiming your own code would
 * "succeed" and mark this session as having really peered — the one claim
 * the app refuses to make about a session no second device ever joined.
 * Session storage, so a reload inside the 15-minute TTL still knows.
 */
const MINTED_KEY = "unfolded:minted-secrets:v1"
const MINTED_LIMIT = 50
let mintedCache: Set<string> | null = null

/** codes compare in their normalized form; tokens are verbatim */
function normalizeSecret(value: string): string {
  const code = value.toUpperCase().replace(/[^A-Z0-9]/g, "")
  return BARE_CODE_RE.test(code) ? code : value
}

function minted(): Set<string> {
  if (mintedCache) return mintedCache
  mintedCache = new Set<string>()
  try {
    const raw = window.sessionStorage.getItem(MINTED_KEY)
    const stored: unknown = raw ? JSON.parse(raw) : null
    if (Array.isArray(stored)) {
      for (const value of stored) if (typeof value === "string") mintedCache.add(value)
    }
  } catch {
    /* no storage (private mode, blocked) — remember for this page's life */
  }
  return mintedCache
}

export function rememberMintedSecret(value: string): void {
  if (typeof window === "undefined" || !value) return
  const set = minted()
  set.add(normalizeSecret(value))
  // insertion-ordered: the oldest goes first
  for (const oldest of set) {
    if (set.size <= MINTED_LIMIT) break
    set.delete(oldest)
  }
  try {
    window.sessionStorage.setItem(MINTED_KEY, JSON.stringify([...set]))
  } catch {
    /* best effort */
  }
}

/** did THIS tab mint it? then it is our own session, and no offer at all */
export function isMintedHere(value: string): boolean {
  if (typeof window === "undefined") return false
  return minted().has(normalizeSecret(value))
}

/** test seam: forget what this tab minted (and any stored copy) */
export function forgetMintedSecrets(): void {
  mintedCache = null
  try {
    window.sessionStorage.removeItem(MINTED_KEY)
  } catch {
    /* nothing to forget */
  }
}

/* ------------------------------------------------------------------ */
/* the watch                                                           */
/* ------------------------------------------------------------------ */

export interface PairingClipboardWatchOptions {
  /** called at most once per distinct offer; the caller decides what to show */
  onOffer: (offer: PairingOffer) => void
  /** injectable for tests; the default never prompts for permission */
  readClipboard?: () => Promise<string | null>
}

/**
 * A read that can only ever succeed silently: no permission prompt, no
 * error surfaced. Firefox has no clipboard-read permission at all and
 * Safari gates reads behind an explicit paste — both simply fall through
 * to the paste path, which needs nothing.
 */
async function readClipboardIfGranted(): Promise<string | null> {
  try {
    if (typeof navigator === "undefined") return null
    const { clipboard, permissions } = navigator
    if (!clipboard?.readText || !permissions?.query) return null
    const status = await permissions.query({ name: "clipboard-read" as PermissionName })
    if (status.state !== "granted") return null
    return await clipboard.readText()
  } catch {
    return null
  }
}

/** a paste into a field is the person filling that field in, not an offer */
function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  if (element.isContentEditable) return true
  return element.tagName === "INPUT" || element.tagName === "TEXTAREA"
}

/** start watching; returns the function that stops it */
export function startPairingClipboardWatch({
  onOffer,
  readClipboard = readClipboardIfGranted,
}: PairingClipboardWatchOptions): () => void {
  // one offer per secret for the life of the watch: a dismissed banner
  // stays dismissed, and a spent code is never proposed twice
  const seen = new Set<string>()
  const consider = (text: string | null | undefined) => {
    if (!text) return
    const offer = readPairingOffer(text)
    if (!offer || seen.has(offer.secret) || isMintedHere(offer.secret)) return
    seen.add(offer.secret)
    onOffer(offer)
  }
  const onPaste = (event: ClipboardEvent) => {
    if (isTypingTarget(event.target)) return
    consider(event.clipboardData?.getData("text"))
  }
  const poll = () => {
    void readClipboard()
      .then(consider)
      .catch(() => {
        /* a read that fails is simply no offer */
      })
  }

  document.addEventListener("paste", onPaste)
  window.addEventListener("focus", poll)
  document.addEventListener("visibilitychange", poll)
  poll()

  return () => {
    document.removeEventListener("paste", onPaste)
    window.removeEventListener("focus", poll)
    document.removeEventListener("visibilitychange", poll)
  }
}
