import type { ClaySettings, FormParams, FormType, SetClayInput, UpdateFormInput } from "./schemas"
import { setClayInputSchema, updateFormInputSchema } from "./schemas"
import type { PaperSize } from "@/lib/export/svg"

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
}

/** friendly names accepted (and emitted) for the `type` parameter */
const TYPE_ALIASES: Record<string, { type: FormType; facets?: number }> = {
  cylinder: { type: "cylinder" },
  tapered: { type: "tapered" },
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
    if (alias.facets !== undefined) form.facets = alias.facets
  }
  const facets = num("facets")
  if (facets !== undefined) form.facets = clamp(Math.round(facets), 3, 8)
  const height = num("height")
  if (height !== undefined) form.heightMm = clamp(height, 20, 600)
  const bottom = num("bottom")
  if (bottom !== undefined) form.bottomDiameterMm = clamp(bottom, 20, 500)
  const top = num("top")
  if (top !== undefined) form.topDiameterMm = clamp(top, 20, 500)
  const name = params.get("name")?.trim().slice(0, 60)
  if (name) form.name = name

  const clay: SetClayInput = {}
  const shrinkage = num("shrinkage")
  if (shrinkage !== undefined) clay.shrinkagePct = clamp(shrinkage, 0, 25)
  const wall = num("wall")
  if (wall !== undefined) clay.wallThicknessMm = clamp(wall, 2, 15)

  const paperRaw = params.get("paper")?.trim().toLowerCase()
  const paperSize: PaperSize | undefined =
    paperRaw === "a4" ? "A4" : paperRaw === "letter" ? "Letter" : undefined

  const out: SharePatches = {}
  // clamped values are in range, but run the schemas anyway so nothing
  // out-of-contract can ever reach the store
  const formParsed = updateFormInputSchema.safeParse(form)
  if (formParsed.success && Object.keys(formParsed.data).length > 0) out.form = formParsed.data
  const clayParsed = setClayInputSchema.safeParse(clay)
  if (clayParsed.success && Object.keys(clayParsed.data).length > 0) out.clay = clayParsed.data
  if (paperSize) out.paperSize = paperSize
  return out
}

const fmtNum = (n: number) => String(Number(n.toFixed(1)))

export function buildShareParams(
  form: FormParams,
  clay: ClaySettings,
  paperSize: PaperSize
): URLSearchParams {
  const params = new URLSearchParams()
  params.set("type", form.type === "faceted" ? (FACET_NAMES[form.facets] ?? "faceted") : form.type)
  params.set("height", fmtNum(form.heightMm))
  params.set("bottom", fmtNum(form.bottomDiameterMm))
  if (form.type === "tapered") params.set("top", fmtNum(form.topDiameterMm))
  if (form.name) params.set("name", form.name)
  params.set("shrinkage", fmtNum(clay.shrinkagePct))
  params.set("wall", fmtNum(clay.wallThicknessMm))
  params.set("paper", paperSize)
  return params
}

/** Absolute share URL on the current origin (relative when there is no window, e.g. tests). */
export function shareUrl(form: FormParams, clay: ClaySettings, paperSize: PaperSize): string {
  const qs = buildShareParams(form, clay, paperSize).toString()
  if (typeof window === "undefined") return `?${qs}`
  return `${window.location.origin}${window.location.pathname}?${qs}`
}
