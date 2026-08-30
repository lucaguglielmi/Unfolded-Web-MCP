import { useMemo } from "react"
import { ExportPdfDialog } from "@/components/ExportPdfDialog"
import { InfoTip } from "@/components/InfoTip"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { describePiece, shrinkageScale } from "@/lib/geometry/unroll"
import {
  countPages,
  layoutPieces,
  textFits,
  tickMarks,
  ANNOTATION_FONT_MM,
  ANNOTATION_OFFSET_MM,
  LABEL_FONT_MM,
  NAME_FONT_MM,
  NAME_OFFSET_MM,
  STAMP_FONT_MM,
  STAMP_OFFSET_MM,
  type PaperSize,
} from "@/lib/export/svg"
import { selectPieces, useProjectStore } from "@/store/useProjectStore"

export function TemplatePanel() {
  const form = useProjectStore((s) => s.form)
  const clay = useProjectStore((s) => s.clay)
  const paperSize = useProjectStore((s) => s.paperSize)
  const unit = useProjectStore((s) => s.unit)
  const setPaperSize = useProjectStore((s) => s.setPaperSize)

  const pieces = useMemo(() => selectPieces(form, clay), [form, clay])
  const layout = useMemo(() => layoutPieces(pieces, paperSize), [pieces, paperSize])
  const pages = countPages(layout, paperSize)
  const scale = shrinkageScale(clay.shrinkagePct)

  const PAD = 16

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-medium">
            Flat templates
            <InfoTip>
              Printed pieces are larger than the fired pot: they include your clay's
              shrinkage. Each dimension shows the printed (wet) size with the fired size
              alongside it. Cut slabs to the template and the finished piece fires down
              to the size you designed.
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
              <TabsTrigger value="A3">A3</TabsTrigger>
              <TabsTrigger value="Letter">Letter</TabsTrigger>
            </TabsList>
          </Tabs>
          {/* On mobile this panel only appears in the full-screen template
              view, which covers the sticky export bar — so the header button
              is the direct Export action there, and never a duplicate. */}
          <ExportPdfDialog
            trigger={<Button size="sm">Export PDF</Button>}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <svg
          className="mx-auto h-auto w-full max-w-2xl"
          viewBox={`${-PAD} ${-PAD} ${layout.widthMm + 2 * PAD} ${layout.heightMm + 2 * PAD}`}
        >
          {layout.placed.map(({ piece, graphic, dx, dy }) => {
            const availableWidth = graphic.textWidthMm ?? graphic.widthMm
            // uppercase runs wider than the mixed-case average, hence 1.15
            const showName = textFits(form.name, NAME_FONT_MM * 1.15, availableWidth)
            const showLabel = textFits(piece.label, LABEL_FONT_MM, availableWidth)
            const dimsText = describePiece(piece, scale, unit).replace(`${piece.label}: `, "")
            const showDims = textFits(dimsText, ANNOTATION_FONT_MM, availableWidth)

            return (
              <g key={piece.id} transform={`translate(${dx} ${dy})`}>
                <path d={graphic.d} strokeWidth={0.8} className="fill-muted/50 stroke-foreground" />
                {graphic.seams.map((seam, i) => (
                  <g key={i} className="stroke-muted-foreground">
                    <line
                      x1={seam.x1}
                      y1={seam.y1}
                      x2={seam.x2}
                      y2={seam.y2}
                      strokeWidth={0.8}
                      strokeDasharray="5 3"
                    />
                    {tickMarks(seam).map((tick, j) => (
                      <line key={j} x1={tick.x1} y1={tick.y1} x2={tick.x2} y2={tick.y2} strokeWidth={0.8} />
                    ))}
                  </g>
                ))}
                {showName && (
                  <text
                    x={graphic.labelAt.x}
                    y={graphic.labelAt.y - NAME_OFFSET_MM}
                    textAnchor="middle"
                    fontSize={NAME_FONT_MM}
                    letterSpacing={0.3}
                    className="fill-muted-foreground"
                  >
                    {form.name.toUpperCase()}
                  </text>
                )}
                {showLabel && (
                  <text
                    x={graphic.labelAt.x}
                    y={graphic.labelAt.y}
                    textAnchor="middle"
                    fontSize={LABEL_FONT_MM}
                    className="fill-foreground font-semibold"
                  >
                    {piece.label}
                  </text>
                )}
                {(piece.kind === "rectangle" || piece.kind === "trapezoid") &&
                  piece.stamp &&
                  textFits(piece.stamp, STAMP_FONT_MM, availableWidth) && (
                    <text
                      x={graphic.labelAt.x}
                      y={graphic.labelAt.y + STAMP_OFFSET_MM}
                      textAnchor="middle"
                      fontSize={STAMP_FONT_MM}
                      className="fill-muted-foreground"
                    >
                      {piece.stamp}
                    </text>
                  )}
                {showDims && (
                  <text
                    x={graphic.widthMm / 2}
                    y={graphic.heightMm + ANNOTATION_OFFSET_MM}
                    textAnchor="middle"
                    fontSize={ANNOTATION_FONT_MM}
                    className="fill-muted-foreground"
                  >
                    {dimsText}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
        <p className="text-muted-foreground mx-auto mt-2 max-w-2xl text-xs">
          Dashed edges are seams — bevel at the angle stamped on the piece, then score
          &amp; slip; tick marks are registration marks. Small pieces that can't fit
          their label or dimensions just print blank rather than overflow. The PDF tiles
          pages with 10 mm glue overlaps and includes a calibration ruler — always print
          at 100%.
        </p>
      </div>
    </div>
  )
}
