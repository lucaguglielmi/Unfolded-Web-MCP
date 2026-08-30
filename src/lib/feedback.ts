/**
 * Tactile feedback for the interface: a short vibration where the platform
 * has one (Android; iOS Safari exposes no vibration API) paired with a tiny
 * synthesized click, quiet enough to read as texture rather than sound.
 *
 * Everything is generated with WebAudio — no audio files, no network. The
 * AudioContext is created lazily inside the first user gesture, which is
 * exactly when browsers allow audio to start.
 */

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

/** small controls: unit toggle, undo/redo, paper tabs, slider release */
export function tapFeedback() {
  vibrate(8)
  blip(1900, 0.045, 28)
}

/** picking an option: shape, profile, preset — slightly deeper "tock" */
export function selectFeedback() {
  vibrate(12)
  blip(1250, 0.055, 42)
}

/** something completed: PDF exported, link copied — a little double-tick */
export function successFeedback() {
  vibrate([10, 70, 14])
  blip(1500, 0.05, 36)
  blip(2000, 0.045, 48, 90)
}
