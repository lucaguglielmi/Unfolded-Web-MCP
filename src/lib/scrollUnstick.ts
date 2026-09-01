/**
 * iOS Safari can scroll the DOCUMENT of a page that isn't supposed to
 * scroll at all (the app shell is h-dvh + overflow-hidden; only the
 * settings panel scrolls internally). It happens when the browser nudges
 * the page to reveal a focused input, or while restoring a backgrounded
 * tab as its toolbar chrome resizes. Once it has happened the layout sits
 * clipped under the browser chrome and NO gesture can bring it back —
 * overscroll is disabled and there is no scrollable document to swipe —
 * so the page looks broken until a refresh.
 *
 * The watchdog is deliberately self-limiting: it only ever acts when the
 * document truly cannot scroll (content fits the viewport), so the
 * explainer pages — which scroll the document legitimately — are never
 * touched, and a future taller layout would automatically opt out.
 */

let installed = false

function unstick(): void {
  const active = document.activeElement
  // while typing, the browser's nudge is doing its job — leave it alone
  if (
    active instanceof HTMLElement &&
    (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)
  ) {
    return
  }
  const doc = document.documentElement
  const scrolled = Math.max(window.scrollY, doc.scrollTop, window.visualViewport?.pageTop ?? 0)
  if (scrolled > 0 && doc.scrollHeight <= window.innerHeight + 1) {
    window.scrollTo(0, 0)
  }
}

/** a beat after the triggering event, so the browser's own scroll settles first */
function unstickSoon(): void {
  window.setTimeout(unstick, 250)
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
  // toolbar chrome expanding/collapsing resizes the visual viewport
  window.visualViewport?.addEventListener("resize", unstickSoon)
}
