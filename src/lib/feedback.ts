/**
 * Tactile feedback for the interface: a short vibration where the platform
 * has one (Android; iOS Safari exposes no vibration API) paired with a tiny
 * synthesized click, quiet enough to read as texture rather than sound.
 *
 * Everything is generated with WebAudio — no audio files, no network. The
 * AudioContext is created lazily inside the first user gesture, which is
 * exactly when browsers allow audio to start.
 *
 * All call sites go through the single `feedback(kind)` entry so the policy
 * (what deserves feedback, and what flavor) lives in this one file:
 *  - "tap":     small controls — unit toggle, paper tabs, undo/redo
 *  - "select":  picking an option — shape, profile, preset
 *  - "success": something completed — PDF exported, link copied
 *  - "slide":   a slider moving under the finger (throttled internally)
 *  - "release": a drag landing — the satisfying end-of-gesture thock
 *  - "open":    something opening — the export dialog, the 3D preview
 *
 * On top of the explicit calls, `installGlobalFeedback()` (wired at boot)
 * listens for clicks on ANY interactive element — buttons, links, tabs,
 * options, menu rows — and plays the plain tap for those no component
 * covers. It runs on the document (after React's own handlers), and skips
 * itself whenever an explicit flavor just played, so a click never sounds
 * twice. Opt an element out with data-no-feedback on it or an ancestor.
 *
 * A persisted mute switch (the speaker button in the header) silences both
 * the sound and the vibration app-wide.
 */

export type FeedbackKind = "tap" | "select" | "success" | "slide" | "release" | "open"

const MUTED_KEY = "unfolded:feedback-muted"

let muted = readMuted()

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTED_KEY) === "1"
  } catch {
    return false
  }
}

export function isFeedbackMuted(): boolean {
  return muted
}

export function setFeedbackMuted(next: boolean): void {
  muted = next
  try {
    window.localStorage.setItem(MUTED_KEY, next ? "1" : "0")
  } catch {
    // private mode — the preference just won't survive the session
  }
}

let ctx: AudioContext | null = null

function audioCtx(): AudioContext | null {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === "suspended") void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    // some webviews throw on vibrate — feedback is never worth an error
  }
}

/** one short, damped blip — the click's timbre comes from a fast decay */
function blip(freqHz: number, peakGain: number, durationMs: number, delayMs = 0) {
  const ac = audioCtx()
  if (!ac) return
  const t = ac.currentTime + delayMs / 1000
  const osc = ac.createOscillator()
  const gain = ac.createGain()
  osc.type = "triangle"
  osc.frequency.setValueAtTime(freqHz, t)
  gain.gain.setValueAtTime(peakGain, t)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + durationMs / 1000)
  osc.connect(gain)
  gain.connect(ac.destination)
  osc.start(t)
  osc.stop(t + durationMs / 1000)
}

/** when any flavor last actually played — the global tap defers to it */
let lastPlayedAt = 0
/** slides are throttled so a fast drag reads as a purr, not a machine gun */
let lastSlideAt = 0
const SLIDE_MIN_GAP_MS = 45
/** one explicit flavor per click suppresses the generic document-level tap */
const GLOBAL_SUPPRESS_MS = 150

export function feedback(kind: FeedbackKind): void {
  if (muted) return
  if (kind === "slide") {
    const now = Date.now()
    if (now - lastSlideAt < SLIDE_MIN_GAP_MS) return
    lastSlideAt = now
  }
  lastPlayedAt = Date.now()
  switch (kind) {
    case "tap":
      vibrate(8)
      blip(1900, 0.045, 28)
      break
    case "select":
      vibrate(12)
      blip(1250, 0.055, 42)
      break
    case "success":
      vibrate([10, 70, 14])
      blip(1500, 0.05, 36)
      blip(2000, 0.045, 48, 90)
      break
    case "slide":
      // the faintest tick — texture under the finger, not a beep
      vibrate(3)
      blip(2200, 0.022, 16)
      break
    case "release":
      // low thock with a soft overtone — the gesture landing
      vibrate(14)
      blip(950, 0.06, 60)
      blip(1425, 0.04, 80, 45)
      break
    case "open":
      // a rising pair — something unfolding
      vibrate(10)
      blip(1100, 0.045, 55)
      blip(1650, 0.045, 85, 70)
      break
  }
}

/** everything a generic click should tick for */
const INTERACTIVE_SELECTOR =
  'button, a[href], [role="button"], [role="tab"], [role="option"], [role="menuitem"], [role="menuitemradio"], label[for], select, summary'

/**
 * Document-level click feedback: the plain tap for every interactive
 * element no component covers with a richer flavor. Bubble phase on the
 * document means React's own handlers (which play select/success/open)
 * have already run — the suppression window keeps a click to one sound.
 */
export function installGlobalFeedback(): void {
  if (typeof document === "undefined") return
  document.addEventListener("click", (event) => {
    const target = event.target as Element | null
    const el = target?.closest?.(INTERACTIVE_SELECTOR)
    if (!el || el.closest("[data-no-feedback]")) return
    if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") return
    if (Date.now() - lastPlayedAt < GLOBAL_SUPPRESS_MS) return
    feedback("tap")
  })
}
