import { useState, type ReactNode } from "react"
import { TriangleAlert } from "lucide-react"
import { InfoTip } from "@/components/InfoTip"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formWarnings } from "@/lib/geometry/unroll"
import { PRESETS, type FormType } from "@/lib/model/schemas"
import { useProjectStore } from "@/store/useProjectStore"

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

/**
 * Name field keeps a local draft so the user can clear/retype freely;
 * only valid names (1-60 chars) are committed to the store.
 */
function NameField() {
  const name = useProjectStore((s) => s.form.name)
  const updateForm = useProjectStore((s) => s.updateForm)
  const [draft, setDraft] = useState(name)
  const [lastSeenName, setLastSeenName] = useState(name)

  // follow external changes (agent tools, presets) without clobbering typing
  if (name !== lastSeenName) {
    setLastSeenName(name)
    if (draft !== name) setDraft(name)
  }

  return (
    <Input
      id="form-name"
      aria-label="Piece name"
      value={draft}
      maxLength={60}
      placeholder="Name your piece"
      onChange={(e) => {
        const value = e.target.value.slice(0, 60)
        setDraft(value)
        if (value.trim().length > 0) updateForm({ name: value })
      }}
      onBlur={() => {
        const trimmed = draft.trim()
        if (trimmed.length === 0) {
          setDraft(name)
        } else if (trimmed !== draft) {
          setDraft(trimmed)
          updateForm({ name: trimmed })
        }
      }}
    />
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

        <NameField />

        <Tabs value={form.type} onValueChange={(v) => updateForm({ type: v as FormType })}>
          <TabsList className="w-full">
            <TabsTrigger value="cylinder">Cylinder</TabsTrigger>
            <TabsTrigger value="tapered">Tapered</TabsTrigger>
          </TabsList>
        </Tabs>
        <p className="text-muted-foreground text-xs leading-relaxed">
          {form.type === "cylinder"
            ? "Straight wall — unrolls to a rectangle."
            : "Cone-shaped wall — unrolls to an arc."}{" "}
          Faceted and curved profiles are coming next.
        </p>

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
        <div className="flex flex-wrap gap-2">
          {Object.entries(PRESETS).map(([id, preset]) => (
            <Button
              key={id}
              variant="outline"
              size="sm"
              className="font-normal"
              onClick={() => applyPreset(id as keyof typeof PRESETS)}
            >
              {preset.name}
            </Button>
          ))}
        </div>
      </section>
    </div>
  )
}
