import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"

/**
 * The Unfolded logomark: three folded slabs in cobalt and blue-black.
 * Path data is shared with the PDF exporter (lib/export/pdf.ts) so the
 * printed chrome always matches the app.
 *
 * Slab order matters: 0 is the fixed cobalt sheet, 1 the ink cover hinged
 * on its right edge, 2 the flap hinged on the cover's lower edge. The
 * animated mark nests 2 inside 1 so the flap rides along when the cover
 * folds shut (keyframes live in index.css).
 */

export const LOGO_SLAB_PATHS: { d: string; fill: string }[] = [
  { d: "M46 58Q46 53 51 56l65 36q4 2 4 8v80q0 6-5 3l-65-36q-4-2-4-7V58Z", fill: "#0A5BFF" },
  { d: "m128 94 65-36q5-3 5 3v79q0 5-4 7l-66 36q-5 3-5-3v-79q0-5 5-7Z", fill: "#111827" },
  { d: "m128 188 65-36q4-2 8 0l58 32q6 3 0 7l-65 36q-4 2-8 0l-58-32q-6-3 0-7Z", fill: "#0646CC" },
]

/** tight crop around the three slabs (source coordinate space) */
export const LOGO_VIEWBOX = { x: 40, y: 48, w: 226, h: 186 }

const FOLD_DURATION_MS = 3800 // a hair over the 3.6s CSS cycle
const FOLD_MIN_GAP_MS = 6000
const FOLD_RANDOM_MS = 9000

export function LogoMark({
  className,
  animated = false,
}: {
  className?: string
  /** every once in a while, fold shut and open back up (see index.css; respects reduced motion) */
  animated?: boolean
}) {
  const [folding, setFolding] = useState(false)

  useEffect(() => {
    if (!animated) return
    if (typeof window === "undefined") return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    let cancelled = false
    let showTimer = 0
    let hideTimer = 0
    const schedule = (delay: number) => {
      showTimer = window.setTimeout(() => {
        if (cancelled) return
        setFolding(true)
        hideTimer = window.setTimeout(() => {
          if (cancelled) return
          setFolding(false)
          schedule(FOLD_MIN_GAP_MS + Math.random() * FOLD_RANDOM_MS)
        }, FOLD_DURATION_MS)
      }, delay)
    }
    // one early fold as a hello, then random quiet intervals
    schedule(2500 + Math.random() * 3000)
    return () => {
      cancelled = true
      window.clearTimeout(showTimer)
      window.clearTimeout(hideTimer)
    }
  }, [animated])

  const [base, cover, flap] = LOGO_SLAB_PATHS
  return (
    <svg
      viewBox={`${LOGO_VIEWBOX.x} ${LOGO_VIEWBOX.y} ${LOGO_VIEWBOX.w} ${LOGO_VIEWBOX.h}`}
      className={cn(className, folding && "logo-folding")}
      aria-hidden="true"
    >
      <path d={base.d} fill={base.fill} className="logo-slab" />
      {/* .logo-cover / .logo-flap are the 3D hinges; .logo-ink: the blue-black
          slab would vanish on a dark header — index.css lightens it in dark mode */}
      <g className={cn(animated && "logo-cover")}>
        <path d={cover.d} fill={cover.fill} className="logo-slab logo-ink" />
        <g className={cn(animated && "logo-flap")}>
          <path d={flap.d} fill={flap.fill} className="logo-slab" />
        </g>
      </g>
    </svg>
  )
}
