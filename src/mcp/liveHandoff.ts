import { shareUrl } from "@/lib/model/shareLink"
import { liveSync } from "@/store/syncClient"
import { useProjectStore } from "@/store/useProjectStore"

/**
 * The agent's one way to hand the potter a LIVE continuation link
 * (docs/live-handoff-link-spec.md). Two URL contracts exist and must
 * never be confused:
 *
 *  - designUrl — a permanent permalink: the parameters and nothing else.
 *    Reopens an independent copy, bookmarkable, printable, months later.
 *    Every state snapshot carries one; it is also the address bar.
 *  - liveHandoffUrl — the same parameters plus ?via=chatgpt and a fresh
 *    single-use ?join= token: the tab that opens it claims the token and
 *    follows THIS tab's session both ways. Minted on demand, right here,
 *    and only here — state reads stay pure and never spend a token.
 *
 * Fail-closed: when no token can be minted there is no link at all — a
 * permanent link handed out in its place would open the right shape and
 * silently not pair, which is the incident the spec exists to end.
 */

export const LIVE_HANDOFF_INSTRUCTION =
  "Return liveHandoffUrl verbatim as the default link after creating or editing. " +
  "Do not use the browser address-bar URL. " +
  "Use designUrl only for an explicitly requested permanent or independent copy."

export interface LiveHandoff {
  liveHandoffUrl: string
  designUrl: string
  /** epoch ms */
  expiresAt: number
  expiresInSeconds: number
  singleUse: true
  instruction: string
}

export interface LiveHandoffDeps {
  mintToken?: () => Promise<{ token: string; expiresAt: number } | null>
  now?: () => number
}

/**
 * Mint a token and build both links from the design as it is NOW (after
 * the mint resolves, so a concurrent edit is never left out). Null when
 * the pairing service could not mint, or handed back an already-expired
 * token — the caller reports failure and returns no URL.
 */
export async function createLiveHandoff({
  mintToken = () => liveSync.mintToken(),
  now = Date.now,
}: LiveHandoffDeps = {}): Promise<LiveHandoff | null> {
  const minted = await mintToken()
  if (!minted || minted.expiresAt <= now()) return null
  const { form, clay, paperSize, unit } = useProjectStore.getState()
  return {
    liveHandoffUrl: shareUrl(form, clay, paperSize, {
      unit,
      viaChatGpt: true,
      joinToken: minted.token,
    }),
    designUrl: shareUrl(form, clay, paperSize, { unit }),
    expiresAt: minted.expiresAt,
    expiresInSeconds: Math.max(0, Math.round((minted.expiresAt - now()) / 1000)),
    singleUse: true,
    instruction: LIVE_HANDOFF_INSTRUCTION,
  }
}
