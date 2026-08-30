import { type ReactNode } from "react"
import {
  Amphora,
  Coffee,
  Cone,
  CupSoda,
  Cylinder,
  Hexagon,
  Pentagon,
  Square,
  Triangle,
  TriangleAlert,
} from "lucide-react"
import { IconOptionGroup } from "@/components/IconOptionGroup"
import { InfoTip } from "@/components/InfoTip"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import { formWarnings } from "@/lib/geometry/unroll"
import { PRESETS, type FormType } from "@/lib/model/schemas"
import { useProjectStore } from "@/store/useProjectStore"

/**
 * Shape choices: the round forms plus the faceted-prism family. Every
 * faceted option is the same geometry parameterized by side count, encoded
 * as "f<N>" in the picker value and decoded back to {type, facets}.
 */
const SHAPE_OPTIONS = [
  { value: "cylinder", label: "Cylinder", icon: Cylinder },
  { value: "tapered", label: "Tapered", icon: Cone },
  { value: "f3", label: "Triangle", icon: Triangle },
  { value: "f4", label: "Square", icon: Square },
  { value: "f5", label: "Pentagon", icon: Pentagon },
  { value: "f6", label: "Hexagon", icon: Hexagon },
]

const SHAPE_DESCRIPTIONS: Record<string, string> = {
  cylinder: "Straight round wall — unrolls to a rectangle.",
  tapered: "Cone-shaped wall — unrolls to an arc.",
  faceted: "Flat sides joined at mitered corners — unrolls to identical panels + a polygon base.",
}

const PRESET_ICONS: Record<string, typeof Coffee> = {
  "classic-mug": Coffee,
  tumbler: CupSoda,
  "bud-vase": Amphora,
  "hex-planter": Hexagon,
}

function SectionTitle({ children, tip }: { children: ReactNode; tip?: ReactNode }) {
  return (
    <h3 className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium tracking-wider uppercase">
      {children}
      {tip && <InfoTip>{tip}</InfoTip>}
    </h3>
  )
}

function DimensionSlider({
  label,
  tip,
  value,
  min,
  max,
  step = 1,
  unit = "mm",
  onChange,
}: {
  label: string
  tip?: ReactNode
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
        <Label className="gap-1.5 font-normal">
          {label}
          {tip && <InfoTip>{tip}</InfoTip>}
        </Label>
        <span className="text-foreground/80 text-sm tabular-nums">
          {value} {unit}
        </span>
      </div>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={([v]) => onChange(v)} />
    </div>
  )
}

export function ParamsPanel() {
  const form = useProjectStore((s) => s.form)
  const clay = useProjectStore((s) => s.clay)
  const updateForm = useProjectStore((s) => s.updateForm)
  const setClay = useProjectStore((s) => s.setClay)
  const applyPreset = useProjectStore((s) => s.applyPreset)

  const warnings = formWarnings(form, clay)

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <SectionTitle tip="All dimensions are the fired result you want. The printable templates are automatically scaled up to compensate for clay shrinkage.">
          Form
        </SectionTitle>

        {/* form.name stays in the model (export dialog, PDF stamps, share
            links, agent tools) — it's just not edited here anymore */}

        <IconOptionGroup
          value={form.type === "faceted" ? `f${form.facets}` : form.type}
          onChange={(v) =>
            v.startsWith("f")
              ? updateForm({ type: "faceted", facets: Number(v.slice(1)) })
              : updateForm({ type: v as FormType })
          }
          options={SHAPE_OPTIONS}
          columns={3}
        />
        <p className="text-muted-foreground text-xs leading-relaxed">
          {SHAPE_DESCRIPTIONS[form.type]} Curved profiles are coming next.
        </p>

        <DimensionSlider
          label="Height"
          value={form.heightMm}
          min={20}
          max={400}
          onChange={(v) => updateForm({ heightMm: v })}
        />
        <DimensionSlider
          label={
            form.type === "tapered"
              ? "Bottom diameter"
              : form.type === "faceted"
                ? "Width (across corners)"
                : "Diameter"
          }
          tip={
            form.type === "faceted"
              ? "Measured corner to corner (the circle the corners sit on). The width across the flat faces is a bit smaller — both are listed on the base template."
              : undefined
          }
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
      </section>

      <Separator />

      <section className="space-y-4">
        <SectionTitle tip="Your clay body determines how the flat templates are computed. Set these once per clay and reuse them across pieces.">
          Clay
        </SectionTitle>

        <DimensionSlider
          label="Shrinkage"
          tip="Clay shrinks as it dries and fires — most stoneware loses 10–13% of its size. Enter your clay body's total wet-to-fired shrinkage; every template is scaled up so the fired piece matches the dimensions you designed. Check your clay's datasheet or measure a test tile."
          value={clay.shrinkagePct}
          min={0}
          max={25}
          step={0.5}
          unit="%"
          onChange={(v) => setClay({ shrinkagePct: v })}
        />
        <DimensionSlider
          label="Wall thickness"
          tip="The thickness of your rolled slab. A slab bends along its middle, so templates are computed on the wall's mid-surface — using the outer size would make wrapped walls come out slightly too big."
          value={clay.wallThicknessMm}
          min={2}
          max={15}
          step={0.5}
          onChange={(v) => setClay({ wallThicknessMm: v })}
        />
      </section>

      {warnings.length > 0 && (
        <div className="space-y-1.5 rounded-md border border-amber-200 bg-amber-50 p-3">
          {warnings.map((warning) => (
            <p key={warning} className="flex gap-2 text-xs leading-relaxed text-amber-800">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              {warning}
            </p>
          ))}
        </div>
      )}

      <Separator />

      <section className="space-y-3">
        <SectionTitle>Presets</SectionTitle>
        <div className="grid grid-cols-3 gap-2">
          {Object.entries(PRESETS).map(([id, preset]) => {
            const Icon = PRESET_ICONS[id] ?? Coffee
            return (
              <Button
                key={id}
                variant="outline"
                className="h-auto flex-col gap-1.5 py-3 font-normal"
                onClick={() => applyPreset(id as keyof typeof PRESETS)}
              >
                <Icon className="size-5" />
                <span className="text-xs leading-tight">{preset.name}</span>
              </Button>
            )
          })}
        </div>
      </section>
    </div>
  )
}
