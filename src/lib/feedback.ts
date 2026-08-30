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
 *  - "tap":     small controls — unit toggle, paper tabs, undo/redo, a
 *               slider drag landing
 *  - "select":  picking an option — shape, profile, preset
 *  - "success": something completed — PDF exported, link copied
 *
 * A persisted mute switch (the speaker button in the header) silences both
 * the sound and the vibration app-wide.
 */

export type FeedbackKind = "tap" | "select" | "success"

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

export function feedback(kind: FeedbackKind): void {
  if (muted) return
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
  }
}
