import { useProjectStore } from "@/store/useProjectStore"
import { Button } from "@/components/ui/button"

/**
 * The one truthful fallback for a downed 3D preview (hardening spec
 * §5.1/§5.2): both failure paths — no WebGL at all, and a reclaimed/lost
 * context — render this component, so there is a single error experience.
 *
 * Instead of a logo, it draws a lightweight 2D silhouette of the CURRENT
 * form (side profile from height and diameters), so the potter still sees
 * their design move while sliders change — parameters, templates, and PDF
 * export all keep working without the canvas.
 */

/** side-profile silhouette: a trapezoid in a fixed viewBox, proportions
    from the live form; cheap enough to re-render on every param change */
function FormSilhouette() {
  const form = useProjectStore((s) => s.form)
  const box = 96
  const pad = 10
  const span = box - pad * 2
  const top = form.tapered ? form.topDiameterMm : form.bottomDiameterMm
  const widest = Math.max(top, form.bottomDiameterMm, 1)
  const scale = span / Math.max(widest, form.heightMm)
  const h = form.heightMm * scale
  const wTop = top * scale
  const wBottom = form.bottomDiameterMm * scale
  const cx = box / 2
  const yTop = (box - h) / 2
  const yBottom = yTop + h
  const points = [
    `${cx - wTop / 2},${yTop}`,
    `${cx + wTop / 2},${yTop}`,
    `${cx + wBottom / 2},${yBottom}`,
    `${cx - wBottom / 2},${yBottom}`,
  ].join(" ")
  return (
    <svg
      viewBox={`0 0 ${box} ${box}`}
      className="h-20 w-20"
      aria-label={`Side profile of ${form.name}`}
      role="img"
    >
      <polygon
        points={points}
        className="fill-muted stroke-muted-foreground/50"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* rim line hints at the open top */}
      <line
        x1={cx - wTop / 2}
        y1={yTop}
        x2={cx + wTop / 2}
        y2={yTop}
        className="stroke-muted-foreground/70"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function ViewportFallback({
  mode,
  onRetry,
}: {
  /** "no-webgl": retrying can't help, say so plainly; "asleep": a fresh
      canvas usually recovers, offer the wake button */
  mode: "no-webgl" | "asleep"
  onRetry?: () => void
}) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-4">
      <FormSilhouette />
      {mode === "no-webgl" ? (
        <p className="text-muted-foreground max-w-56 text-center text-xs leading-relaxed">
          The 3D preview isn't available in this browser — your design, templates,
          and PDF export all still work.
        </p>
      ) : (
        <>
          <p className="text-muted-foreground max-w-64 text-center text-xs leading-relaxed">
            The 3D preview went to sleep while this tab was in the background.
            Your design, templates, and PDF export are untouched.
          </p>
          <Button variant="outline" size="sm" onClick={onRetry}>
            Wake the preview
          </Button>
        </>
      )}
    </div>
  )
}
