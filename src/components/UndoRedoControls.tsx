import { Redo2, Undo2 } from "lucide-react"
import { feedback } from "@/lib/feedback"
import { cn } from "@/lib/utils"
import { useProjectStore } from "@/store/useProjectStore"

/**
 * Undo/redo, floating at the bottom-left of the preview — the thumbnail
 * card on mobile, the 3D viewport when expanded or on desktop. Works on
 * changes from the person and the agent alike.
 */
export function UndoRedoControls({ className }: { className?: string }) {
  const canUndo = useProjectStore((s) => s.history.length > 0)
  const canRedo = useProjectStore((s) => s.future.length > 0)
  const undo = useProjectStore((s) => s.undo)
  const redo = useProjectStore((s) => s.redo)

  const buttonClass =
    "bg-background/90 text-foreground flex size-8 items-center justify-center rounded-md border shadow-sm transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40"

  return (
    <div className={cn("absolute bottom-2.5 left-2.5 z-20 flex gap-1.5", className)}>
      <button
        type="button"
        aria-label="Undo last change"
        title="Undo last change"
        disabled={!canUndo}
        onClick={() => undo() && feedback("tap")}
        className={buttonClass}
      >
        <Undo2 className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label="Redo last undone change"
        title="Redo"
        disabled={!canRedo}
        onClick={() => redo() && feedback("tap")}
        className={buttonClass}
      >
        <Redo2 className="size-3.5" />
      </button>
    </div>
  )
}
