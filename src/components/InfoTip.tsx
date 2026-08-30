import { useRef, useState, type ReactNode } from "react"
import { Info } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

/**
 * Small inline "?" affordance that explains a pottery/geometry concept.
 *
 * Works for both pointers. Radix tooltips are hover-only by design — on
 * touch, a tap flashes the tip and immediately dismisses it — and in
 * controlled mode Radix reports the hover-open but not the hover-close,
 * so this component owns the whole lifecycle:
 *  - mouse: enter shows, leave hides (unless pinned)
 *  - tap/click: PINS the tip open; a tap or click anywhere else (or
 *    Escape) closes it — Radix still reports those outside dismissals
 *    through onOpenChange(false), which also clears the pin
 */
export function InfoTip({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const pinned = useRef(false)

  return (
    <Tooltip
      open={open}
      onOpenChange={(next) => {
        if (!next) pinned.current = false
        setOpen(next)
      }}
    >
      <TooltipTrigger asChild>
        <button
          type="button"
          tabIndex={-1}
          aria-label="More info"
          onPointerEnter={(event) => {
            if (event.pointerType === "mouse") setOpen(true)
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === "mouse" && !pinned.current) setOpen(false)
          }}
          onClick={(event) => {
            // don't let a wrapping <Label> steal the activation
            event.preventDefault()
            pinned.current = true
            setOpen(true)
          }}
          className="text-muted-foreground/60 hover:text-foreground inline-flex cursor-help align-middle transition-colors"
        >
          <Info className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 leading-relaxed">{children}</TooltipContent>
    </Tooltip>
  )
}
