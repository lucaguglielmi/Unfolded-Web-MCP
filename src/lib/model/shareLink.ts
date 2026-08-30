import type { ClaySettings, FormParams, FormType, SetClayInput, UpdateFormInput } from "./schemas"
import { setClayInputSchema, updateFormInputSchema } from "./schemas"
import type { PaperSize } from "@/lib/export/svg"
import type { Unit } from "@/lib/units"

/**
 * Share links: the whole design encoded as URL query parameters, e.g.
 *
 *   ?type=tapered&height=600&bottom=300&top=100&shrinkage=12&wall=5
 *
 * Opening the app with these params loads the design; the `open_model`
 * WebMCP tool applies the same links inside a running session. Everything
 * is relative to the current origin — the deployed domain can change and
 * links keep working, they just need their query string.
 *
 * Parsing is deliberately forgiving: unknown keys are ignored, malformed
 * numbers are dropped, out-of-range values are clamped into the schema's
 * range. A bad link opens the app with whatever was usable instead of
 * crashing or refusing.
 */

export interface SharePatches {
  form?: UpdateFormInput
  clay?: SetClayInput
  paperSize?: PaperSize
  /** preferred display unit riding along with the design */
  unit?: Unit
}

/** friendly names accepted (and emitted) for the `type` parameter */
const TYPE_ALIASES: Record<string, { type: FormType; tapered?: boolean; facets?: number }> = {
  round: { type: "round" },
  cylinder: { type: "round", tapered: false },
  tapered: { type: "round", tapered: true },
  faceted: { type: "faceted" },
  triangle: { type: "faceted", facets: 3 },
  square: { type: "faceted", facets: 4 },
  pentagon: { type: "faceted", facets: 5 },
  hexagon: { type: "faceted", facets: 6 },
  heptagon: { type: "faceted", facets: 7 },
  octagon: { type: "faceted", facets: 8 },
}

const FACET_NAMES: Record<number, string> = {
  3: "triangle",
  4: "square",
  5: "pentagon",
  6: "hexagon",
  7: "heptagon",
  8: "octagon",
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

/**
 * Extract the query string from whatever the caller has: a full URL on any
 * domain, a bare "?type=..." / "type=..." string, or an URLSearchParams.
 */
function toParams(input: string | URLSearchParams): URLSearchParams {
  if (input instanceof URLSearchParams) return input
  const s = input.trim()
  try {
    // full URL (any origin — share links survive domain changes)
    return new URL(s).searchParams
  } catch {
    return new URLSearchParams(s.startsWith("?") ? s.slice(1) : s)
  }
}

export function parseShareParams(input: string | URLSearchParams): SharePatches {
  const params = toParams(input)
  const num = (key: string): number | undefined => {
    const raw = params.get(key)
    if (raw === null || raw.trim() === "") return undefined
    const n = Number(raw)
    return Number.isFinite(n) ? n : undefined
  }

  const form: UpdateFormInput = {}
  const typeRaw = params.get("type")?.trim().toLowerCase()
  if (typeRaw && TYPE_ALIASES[typeRaw]) {
    const alias = TYPE_ALIASES[typeRaw]
    form.type = alias.type
    if (alias.tapered !== undefined) form.tapered = alias.tapered
    if (alias.facets !== undefined) form.facets = alias.facets
  }
  const facets = num("facets")
  if (facets !== undefined) form.facets = clamp(Math.round(facets), 3, 8)
  const height = num("height")
  if (height !== undefined) form.heightMm = clamp(height, 20, 600)
  const bottom = num("bottom")
  if (bottom !== undefined) form.bottomDiameterMm = clamp(bottom, 20, 500)
  const top = num("top")
  if (top !== undefined) {
    form.topDiameterMm = clamp(top, 20, 500)
    // an explicit top means a tapered form (e.g. type=hexagon&top=120)
    form.tapered = true
  }
  const taperedRaw = params.get("tapered")?.trim().toLowerCase()
  if (taperedRaw === "1" || taperedRaw === "true") form.tapered = true
  else if (taperedRaw === "0" || taperedRaw === "false") form.tapered = false
  const name = params.get("name")?.trim().slice(0, 60)
  if (name) form.name = name

  const clay: SetClayInput = {}
  const shrinkage = num("shrinkage")
  if (shrinkage !== undefined) clay.shrinkagePct = clamp(shrinkage, 0, 25)
  const wall = num("wall")
  if (wall !== undefined) clay.wallThicknessMm = clamp(wall, 2, 15)

  const paperRaw = params.get("paper")?.trim().toLowerCase()
  const paperSize: PaperSize | undefined =
    paperRaw === "a4" ? "A4" : paperRaw === "a3" ? "A3" : paperRaw === "letter" ? "Letter" : undefined

  const unitRaw = params.get("units")?.trim().toLowerCase() ?? params.get("unit")?.trim().toLowerCase()
  const unit: Unit | undefined =
    unitRaw === "in" || unitRaw === "inch" || unitRaw === "inches"
      ? "in"
      : unitRaw === "cm" || unitRaw === "metric"
        ? "cm"
        : undefined

  const out: SharePatches = {}
  // clamped values are in range, but run the schemas anyway so nothing
  // out-of-contract can ever reach the store
  const formParsed = updateFormInputSchema.safeParse(form)
  if (formParsed.success && Object.keys(formParsed.data).length > 0) out.form = formParsed.data
  const clayParsed = setClayInputSchema.safeParse(clay)
  if (clayParsed.success && Object.keys(clayParsed.data).length > 0) out.clay = clayParsed.data
  if (paperSize) out.paperSize = paperSize
  if (unit) out.unit = unit
  return out
}

const fmtNum = (n: number) => String(Number(n.toFixed(1)))

export function buildShareParams(
  form: FormParams,
  clay: ClaySettings,
  paperSize: PaperSize,
  unit: Unit = "cm"
): URLSearchParams {
  const params = new URLSearchParams()
  // keep the friendly legacy vocabulary: cylinder/tapered for round forms,
  // shape names for faceted (where `top` alone marks the taper)
  params.set(
    "type",
    form.type === "faceted"
      ? (FACET_NAMES[form.facets] ?? "faceted")
      : form.tapered
        ? "tapered"
        : "cylinder"
  )
  params.set("height", fmtNum(form.heightMm))
  params.set("bottom", fmtNum(form.bottomDiameterMm))
  if (form.tapered) params.set("top", fmtNum(form.topDiameterMm))
  if (form.name) params.set("name", form.name)
  params.set("shrinkage", fmtNum(clay.shrinkagePct))
  params.set("wall", fmtNum(clay.wallThicknessMm))
  params.set("paper", paperSize)
  params.set("units", unit)
  return params
}

/** Absolute share URL on the current origin (relative when there is no window, e.g. tests). */
export function shareUrl(
  form: FormParams,
  clay: ClaySettings,
  paperSize: PaperSize,
  unit: Unit = "cm",
  opts?: {
    /**
     * Tag the link as minted by an agent session (?via=chatgpt). A tab that
     * opens such a link shows "Connected via ChatGPT" — the explicit signal
     * that this design is open in the conversation's internal browser.
     * Never emitted for links built by the human-facing UI.
     */
    viaChatGpt?: boolean
  }
): string {
  const params = buildShareParams(form, clay, paperSize, unit)
  if (opts?.viaChatGpt) params.set("via", "chatgpt")
  const qs = params.toString()
  if (typeof window === "undefined") return `?${qs}`
  return `${window.location.origin}${window.location.pathname}?${qs}`
}
