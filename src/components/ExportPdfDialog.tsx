import { useState, type ReactNode } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { countPages, layoutPieces } from "@/lib/export/svg"
import { selectPieces, useProjectStore } from "@/store/useProjectStore"

/**
 * Wraps a trigger button with a small dialog for naming the export — the
 * name is saved back onto the project and printed on the overview page and
 * on every slab piece, so confirming it once here should be deliberate.
 */
export function ExportPdfDialog({ trigger }: { trigger: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")

  const form = useProjectStore((s) => s.form)
  const clay = useProjectStore((s) => s.clay)
  const paperSize = useProjectStore((s) => s.paperSize)
  const isExporting = useProjectStore((s) => s.isExporting)
  const exportError = useProjectStore((s) => s.exportError)
  const updateForm = useProjectStore((s) => s.updateForm)
  const exportPdf = useProjectStore((s) => s.exportPdf)

  const pages = countPages(layoutPieces(selectPieces(form, clay)), paperSize)

  const handleOpenChange = (next: boolean) => {
    if (next) setName(form.name)
    setOpen(next)
  }

  const handleExport = async () => {
    const trimmed = name.trim().slice(0, 60) || form.name
    if (trimmed !== form.name) updateForm({ name: trimmed })
    try {
      await exportPdf()
      setOpen(false)
    } catch {
      // exportError is surfaced from the store below; keep the dialog open to retry
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export template</DialogTitle>
          <DialogDescription>
            This name is saved on the project and printed on the overview page and on
            every slab piece.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="export-project-name">Project name</Label>
          <Input
            id="export-project-name"
            value={name}
            maxLength={60}
            disabled={isExporting}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim().length > 0) handleExport()
            }}
          />
        </div>

        {exportError && <p className="text-xs text-red-600">Export failed: {exportError}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isExporting}>
            Cancel
          </Button>
          <Button onClick={handleExport} disabled={isExporting || name.trim().length === 0}>
            {isExporting && <Loader2 className="size-4 animate-spin" />}
            {isExporting
              ? "Exporting…"
              : `Export PDF · ${pages.totalPages} page${pages.totalPages > 1 ? "s" : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
