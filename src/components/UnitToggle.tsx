import { tapFeedback } from "@/lib/feedback"
import { cn } from "@/lib/utils"
import { useProjectStore } from "@/store/useProjectStore"

/**
 * cm | in display-unit toggle, shared by the params panel and the 3D
 * preview. A display preference only — the model stays metric (mm); the
 * choice is persisted and rides on share links (?units=in).
 */
export function UnitToggle({ className }: { className?: string }) {
  const unit = useProjectStore((s) => s.unit)
  const setUnit = useProjectStore((s) => s.setUnit)

  return (
    <div
      role="radiogroup"
      aria-label="Measurement units"
      className={cn("flex rounded-md border p-0.5", className)}
    >
      {(["cm", "in"] as const).map((u) => (
        <button
          key={u}
          type="button"
          role="radio"
          aria-checked={unit === u}
          onClick={() => {
            if (u !== unit) tapFeedback()
            setUnit(u)
          }}
          className={
            unit === u
              ? "bg-foreground text-background rounded px-2 py-0.5 text-[11px] font-medium"
              : "text-muted-foreground hover:text-foreground rounded px-2 py-0.5 text-[11px] font-medium transition-colors"
          }
        >
          {u}
        </button>
      ))}
    </div>
  )
}
