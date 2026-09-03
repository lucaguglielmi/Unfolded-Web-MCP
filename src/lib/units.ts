/**
 * Display units. Everything in the model, the schemas, and the WebMCP tool
 * inputs/outputs stays MILLIMETERS — the unit preference only changes how
 * lengths are presented to humans: sliders, 3D callouts, template
 * annotations, warnings, and the printed PDF. The preference is remembered
 * in localStorage and rides on share links (?units=in).
 */

export type Unit = "cm" | "in"

export const MM_PER_INCH = 25.4

/** drop trailing decimal zeros ("10.00" -> "10", "1.50" -> "1.5"); an
    integer string is left alone — its zeros are significant ("10" stays "10") */
const trim = (s: string) => (s.includes(".") ? s.replace(/\.?0+$/, "") : s)

/** "28.56 cm" / "11.24 in" — trailing zeros trimmed ("10 cm", not "10.00 cm") */
export function formatLength(mm: number, unit: Unit): string {
  if (unit === "in") return `${trim((mm / MM_PER_INCH).toFixed(2))} in`
  return `${trim((mm / 10).toFixed(2))} cm`
}

/** volume for the capacity line: ml/L in metric, US fl oz in imperial */
export function formatVolume(ml: number, unit: Unit): string {
  if (unit === "in") return `${trim((ml / 29.5735).toFixed(1))} fl oz`
  if (ml >= 1000) return `${trim((ml / 1000).toFixed(ml >= 10000 ? 0 : 1))} L`
  return `${ml} ml`
}

export function isUnit(value: unknown): value is Unit {
  return value === "cm" || value === "in"
}
