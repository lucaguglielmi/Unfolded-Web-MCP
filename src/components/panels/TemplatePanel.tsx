import { useMemo } from "react"
import { InfoTip } from "@/components/InfoTip"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { describePiece } from "@/lib/geometry/unroll"
import { countPages, layoutPieces, tickMarks, type PaperSize } from "@/lib/export/svg"
import { selectPieces, useProjectStore } from "@/store/useProjectStore"

export function TemplatePanel() {
  const form = useProjectStore((s) => s.form)
  const clay = useProjectStore((s) => s.clay)
  const paperSize = useProjectStore((s) => s.paperSize)
  const setPaperSize = useProjectStore((s) => s.setPaperSize)
  const isExporting = useProjectStore((s) => s.isExporting)
  const exportError = useProjectStore((s) => s.exportError)
  const exportPdf = useProjectStore((s) => s.exportPdf)

  const pieces = useMemo(() => selectPieces(form, clay), [form, clay])
  const layout = useMemo(() => layoutPieces(pieces), [pieces])
  const pages = countPages(layout, paperSize)

  const PAD = 16
  const fontSize = Math.max(6, Math.min(12, layout.widthMm / 28))

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-medium">
            Flat templates
            <InfoTip>
              Printed pieces are larger than the fired pot: they include your clay's
              shrinkage. Cut slabs to the template and the finished piece fires down to
              the size you designed.
            </InfoTip>
          </h2>
          <p className="text-muted-foreground text-xs">
            wet-clay scale · {pages.templatePages} template page
            {pages.templatePages > 1 ? "s" : ""} + overview on {paperSize}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={paperSize} onValueChange={(v) => setPaperSize(v as PaperSize)}>
            <TabsList>
              <TabsTrigger value="A4">A4</TabsTrigger>
              <TabsTrigger value="Letter">Letter</TabsTrigger>
            </TabsList>
          </Tabs>
          {/* On mobile the large sticky bar at the bottom of the screen is the
              one Export action — this inline button would just duplicate it. */}
          <Button size="sm" onClick={() => exportPdf()} disabled={isExporting} className="hidden lg:inline-flex">
            {isExporting ? "Exporting…" : "Export PDF"}
          </Button>
        </div>
      </div>

      {exportError && (
        <p className="border-b px-4 py-2 text-xs text-red-600">
          Export failed: {exportError}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <svg
          className="mx-auto h-auto w-full max-w-2xl"
          viewBox={`${-PAD} ${-PAD} ${layout.widthMm + 2 * PAD} ${layout.heightMm + 2 * PAD}`}
        >
          {layout.placed.map(({ piece, graphic, dx, dy }) => (
            <g key={piece.id} transform={`translate(${dx} ${dy})`}>
              <path
                d={graphic.d}
                strokeWidth={0.8}
                className="fill-amber-500/10 stroke-foreground"
              />
              {graphic.seams.map((seam, i) => (
                <g key={i} className="stroke-amber-600 dark:stroke-amber-500">
                  <line
                    x1={seam.x1}
                    y1={seam.y1}
                    x2={seam.x2}
                    y2={seam.y2}
                    strokeWidth={0.8}
                    strokeDasharray="5 3"
                  />
                  {tickMarks(seam).map((tick, j) => (
                    <line
                      key={j}
                      x1={tick.x1}
                      y1={tick.y1}
                      x2={tick.x2}
                      y2={tick.y2}
                      strokeWidth={0.8}
                    />
                  ))}
                </g>
              ))}
              <text
                x={graphic.labelAt.x}
                y={graphic.labelAt.y}
                textAnchor="middle"
                fontSize={fontSize}
                className="fill-foreground font-medium"
              >
                {piece.label}
              </text>
              <text
                x={0}
                y={graphic.heightMm + fontSize * 0.9}
                fontSize={fontSize * 0.62}
                className="fill-muted-foreground"
              >
                {describePiece(piece).replace(`${piece.label}: `, "")}
              </text>
            </g>
          ))}
        </svg>
        <p className="text-muted-foreground mx-auto mt-2 max-w-2xl text-xs">
          Dashed amber edges are seams (45° bevel, score &amp; slip); tick marks are
          registration marks. The PDF tiles pages with 10 mm glue overlaps and includes a
          calibration ruler — always print at 100%.
        </p>
      </div>
    </div>
  )
}
