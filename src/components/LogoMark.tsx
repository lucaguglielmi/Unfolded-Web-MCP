/**
 * The Unfolded logomark: three folded slabs in cobalt and blue-black.
 * Path data is shared with the PDF exporter (lib/export/pdf.ts) so the
 * printed chrome always matches the app.
 */

export const LOGO_SLAB_PATHS: { d: string; fill: string }[] = [
  { d: "M46 58Q46 53 51 56l65 36q4 2 4 8v80q0 6-5 3l-65-36q-4-2-4-7V58Z", fill: "#0A5BFF" },
  { d: "m128 94 65-36q5-3 5 3v79q0 5-4 7l-66 36q-5 3-5-3v-79q0-5 5-7Z", fill: "#111827" },
  { d: "m128 188 65-36q4-2 8 0l58 32q6 3 0 7l-65 36q-4 2-8 0l-58-32q-6-3 0-7Z", fill: "#0646CC" },
]

/** tight crop around the three slabs (source coordinate space) */
export const LOGO_VIEWBOX = { x: 40, y: 48, w: 226, h: 186 }

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox={`${LOGO_VIEWBOX.x} ${LOGO_VIEWBOX.y} ${LOGO_VIEWBOX.w} ${LOGO_VIEWBOX.h}`}
      className={className}
      aria-hidden="true"
    >
      {LOGO_SLAB_PATHS.map((p) => (
        <path key={p.fill} d={p.d} fill={p.fill} />
      ))}
    </svg>
  )
}
