import { useMemo, useState, type ReactNode } from "react"
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { countPages, layoutPieces, type PaperSize } from "@/lib/export/svg"
import { feedback } from "@/lib/feedback"
import { selectPieces, useProjectStore } from "@/store/useProjectStore"

/**
 * Wraps a trigger button with a small dialog that confirms the export:
 * paper size (the page count in the button follows it live) and the
 * project name, which is saved back onto the project and printed on the
 * overview page and on every slab piece.
 */
export function ExportPdfDialog({ trigger }: { trigger: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  // Error state is local to THIS dialog: an export the agent started (and
  // failed) reports to the agent through its tool result, never here.
  const [exportError, setExportError] = useState<string | null>(null)

  const form = useProjectStore((s) => s.form)
  const clay = useProjectStore((s) => s.clay)
  const paperSize = useProjectStore((s) => s.paperSize)
  const setPaperSize = useProjectStore((s) => s.setPaperSize)
  const isExporting = useProjectStore((s) => s.exportsInFlight > 0)
  const updateForm = useProjectStore((s) => s.updateForm)
  const exportPdf = useProjectStore((s) => s.exportPdf)

  const pages = useMemo(
    () => countPages(layoutPieces(selectPieces(form, clay), paperSize), paperSize),
    [form, clay, paperSize]
  )

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setName(form.name)
      setExportError(null)
      feedback("open")
    }
    setOpen(next)
  }

  const handleExport = async () => {
    const trimmed = name.trim().slice(0, 60) || form.name
    if (trimmed !== form.name) updateForm({ name: trimmed })
    setExportError(null)
    // success plays on the click itself — the export usually finishes in
    // well under a second, and one confident sound beats two
    feedback("success")
    try {
      await exportPdf()
      setOpen(false)
    } catch (error) {
      // keep the dialog open to retry
      setExportError(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      {/* Don't auto-focus the name field: most people keep the name, and on
          mobile a focused input pops the keyboard over the dialog */}
      <DialogContent onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Export template</DialogTitle>
          <DialogDescription>
            Unfolded is free for everyone, forever. The printed pages carry a QR — inside
            the largest piece, so it survives cutting — that reopens this exact design.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label>Paper size</Label>
          <Tabs
            value={paperSize}
            onValueChange={(v) => {
              feedback("tap")
              setPaperSize(v as PaperSize)
            }}
          >
            <TabsList className="w-full">
              <TabsTrigger value="A4">A4</TabsTrigger>
              <TabsTrigger value="A3">A3</TabsTrigger>
              <TabsTrigger value="Letter">Letter</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="space-y-2">
          <Label htmlFor="export-project-name">Project name</Label>
          <Input
            id="export-project-name"
            value={name}
            maxLength={60}
            disabled={isExporting}
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
