import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { describePiece } from "@/lib/geometry/unroll"
import { PRESETS, type FormType } from "@/lib/model/schemas"
import { selectPieces, useProjectStore } from "@/store/useProjectStore"

function DimensionSlider({
  label,
  value,
  min,
  max,
  step = 1,
  unit = "mm",
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  onChange: (value: number) => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <span className="text-muted-foreground text-sm tabular-nums">
          {value} {unit}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => onChange(v)}
      />
    </div>
  )
}

export function ParamsPanel() {
  const form = useProjectStore((s) => s.form)
  const clay = useProjectStore((s) => s.clay)
  const updateForm = useProjectStore((s) => s.updateForm)
  const setClay = useProjectStore((s) => s.setClay)
  const applyPreset = useProjectStore((s) => s.applyPreset)

  const pieces = selectPieces(form, clay)

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Form</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="form-name">Name</Label>
            <Input
              id="form-name"
              value={form.name}
              onChange={(e) => updateForm({ name: e.target.value || "Untitled" })}
            />
          </div>

          <Tabs value={form.type} onValueChange={(v) => updateForm({ type: v as FormType })}>
            <TabsList className="w-full">
              <TabsTrigger value="cylinder">Cylinder</TabsTrigger>
              <TabsTrigger value="tapered">Tapered</TabsTrigger>
            </TabsList>
          </Tabs>

          <DimensionSlider
            label="Height"
            value={form.heightMm}
            min={20}
            max={400}
            onChange={(v) => updateForm({ heightMm: v })}
          />
          <DimensionSlider
            label={form.type === "cylinder" ? "Diameter" : "Bottom diameter"}
            value={form.bottomDiameterMm}
            min={20}
            max={300}
            onChange={(v) => updateForm({ bottomDiameterMm: v })}
          />
          {form.type === "tapered" && (
            <DimensionSlider
              label="Top diameter"
              value={form.topDiameterMm}
              min={20}
              max={300}
              onChange={(v) => updateForm({ topDiameterMm: v })}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Clay</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <DimensionSlider
            label="Shrinkage"
            value={clay.shrinkagePct}
            min={0}
            max={25}
            step={0.5}
            unit="%"
            onChange={(v) => setClay({ shrinkagePct: v })}
          />
          <DimensionSlider
            label="Wall thickness"
            value={clay.wallThicknessMm}
            min={2}
            max={15}
            step={0.5}
            onChange={(v) => setClay({ wallThicknessMm: v })}
          />
          <p className="text-muted-foreground text-xs">
            Dimensions above are fired sizes. Templates are scaled up for shrinkage and
            developed along the slab mid-surface.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Template pieces</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {pieces.map((piece) => (
            <div key={piece.id} className="text-sm">
              <Badge variant="secondary" className="mr-2">
                {piece.label}
              </Badge>
              <span className="text-muted-foreground">
                {describePiece(piece).replace(`${piece.label}: `, "")}
              </span>
            </div>
          ))}
          <p className="text-muted-foreground text-xs">Wet-clay sizes, ready to cut.</p>
        </CardContent>
      </Card>

      <Separator />

      <div className="space-y-2">
        <Label>Presets</Label>
        <div className="flex flex-wrap gap-2">
          {Object.entries(PRESETS).map(([id, preset]) => (
            <Button
              key={id}
              variant="outline"
              size="sm"
              onClick={() => applyPreset(id as keyof typeof PRESETS)}
            >
              {preset.name}
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}
