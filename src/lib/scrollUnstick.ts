/**
 * Phone browsers can displace a page that isn't supposed to scroll at all.
 * The studio shell is h-dvh + overflow-hidden (only the settings panel
 * scrolls internally), yet iOS Safari and Android Chrome scroll the
 * DOCUMENT anyway — nudging the page to reveal a focused input above the
 * software keyboard (the pairing code entry), resizing the toolbar chrome,
 * or restoring a backgrounded tab — and can leave it there once the
 * keyboard closes. The header then sits clipped under the browser chrome
 * and NO gesture brings it back: overscroll is disabled and there is no
 * scrollable document to swipe. A focus reveal can likewise scroll the
 * overflow-hidden shell itself (an overflow:hidden box still scrolls
 * programmatically), with the same result.
 *
 * The watchdog snaps both back whenever the viewport settles. On the
 * studio route (the shell is mounted) ANY offset is a displacement; on
 * other routes it acts only when the document truly cannot scroll, so the
 * explainer pages — which scroll legitimately — are never touched. While
 * an input is focused it stays out of the way (the browser's nudge is
 * doing its job) and focusout brings it back. Interested UI can subscribe
 * to each settle pass to re-derive layout state the displacement may have
 * left stale.
 */

const SHELL_SELECTOR = "[data-app-shell]"
/**
 * Two passes after every trigger: one just past the browser's own scroll,
 * one past the keyboard or toolbar animation it may still be running
 * (a single early pass can be undone by the tail of that animation).
 */
const SETTLE_DELAYS_MS = [250, 800]

let installed = false
let pending: number[] = []
const settledListeners = new Set<() => void>()

function isTyping(): boolean {
  const active = document.activeElement
  return (
    active instanceof HTMLElement &&
    (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)
  )
}

/**
 * One settle pass: undo a displacement of the shell or the document.
 * Returns true when something was corrected. Skipped entirely while the
 * person is typing into a field.
 */
export function unstick(): boolean {
  if (typeof document === "undefined" || typeof window === "undefined") return false
  if (isTyping()) return false
  const doc = document.documentElement
  const shell = document.querySelector<HTMLElement>(SHELL_SELECTOR)
  let corrected = false
  // the shell fills the viewport and clips its overflow — it is never
  // meant to hold a scroll offset, so any offset is a displacement
  if (shell && (shell.scrollTop > 0 || shell.scrollLeft > 0)) {
    shell.scrollTop = 0
    shell.scrollLeft = 0
    corrected = true
  }
  const scrolled = Math.max(window.scrollY, doc.scrollTop, window.visualViewport?.pageTop ?? 0)
  const mustNotScroll = shell !== null || doc.scrollHeight <= window.innerHeight + 1
  if (scrolled > 0 && mustNotScroll) {
    window.scrollTo(0, 0)
    corrected = true
  }
  for (const listener of settledListeners) listener()
  return corrected
}

/** a beat after the triggering event, so the browser's own scroll settles first */
function unstickSoon(): void {
  for (const timer of pending) window.clearTimeout(timer)
  pending = SETTLE_DELAYS_MS.map((ms) => window.setTimeout(unstick, ms))
}

/** run `listener` after every settle pass (the viewport has come to rest) */
export function subscribeSettled(listener: () => void): () => void {
  settledListeners.add(listener)
  return () => {
    settledListeners.delete(listener)
  }
}

export function installScrollUnstick(): void {
  if (installed || typeof window === "undefined") return
  installed = true
  // returning to the tab — including restores from the back/forward cache —
  // is exactly when a suspended tab comes back displaced
  window.addEventListener("pageshow", unstickSoon)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") unstickSoon()
  })
  // keyboard dismissal: the focus leaves the input, the nudge should undo
  document.addEventListener("focusout", unstickSoon)
  // toolbar chrome expanding/collapsing resizes the visual viewport; the
  // software keyboard resizes the layout viewport on some Android builds
  window.visualViewport?.addEventListener("resize", unstickSoon)
  window.addEventListener("resize", unstickSoon)
  window.addEventListener("orientationchange", unstickSoon)
  // the displacement itself is a scroll of the document or the shell —
  // catch it at the source, whatever caused it (capture: scroll events
  // don't bubble; the settings panel's own scrolling is filtered out)
  document.addEventListener(
    "scroll",
    (event) => {
      const target = event.target
      if (target === document || (target instanceof Element && target.matches(SHELL_SELECTOR))) {
        unstickSoon()
      }
    },
    { capture: true, passive: true }
  )
}
