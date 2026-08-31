import { liveSync } from "@/store/syncClient"
import { useProjectStore } from "@/store/useProjectStore"

/**
 * Zero-tap "continue on another screen" for agent-driven tabs
 * (docs/live-sync-spec.md v3): once a real agent is driving this tab
 * (agentStatus "native" — a hidden ChatGPT browser, Chrome with the flag),
 * the tab keeps a live session and prefetches one single-use join token at
 * a time. Every shareUrl the agent hands back into the chat carries the
 * current token (see describeState), so the FIRST tap on any of those
 * links makes the visible tab a live follower of this one — no code, no
 * dialog. Tokens burn on claim; each tool result carries a fresh one.
 *
 * If no link is ever tapped, the sync client's solo grace quietly forgets
 * the session — an agent exploring its tools leaves no ghost pairing.
 */

let current: { token: string; expiresAt: number } | null = null
let refilling = false
let started = false

async function refill(): Promise<void> {
  if (refilling) return
  refilling = true
  try {
    current = await liveSync.mintToken()
  } finally {
    refilling = false
  }
}

export function startAgentContinuity(): void {
  if (started || typeof window === "undefined") return
  started = true
  const onNative = () => {
    if (useProjectStore.getState().agentStatus === "native") void refill()
  }
  useProjectStore.subscribe((s) => s.agentStatus, onNative)
  onNative()
}

/**
 * Hand out the prefetched token (single use — consuming it starts the next
 * mint). Null when none is ready yet: the shareUrl simply goes out as a
 * plain design link, and the next result carries a token.
 */
export function takeJoinToken(): string | null {
  if (useProjectStore.getState().agentStatus !== "native") return null
  if (!current || current.expiresAt <= Date.now()) {
    void refill()
    return null
  }
  const token = current.token
  current = null
  void refill()
  return token
}
