/**
 * Deterministic input generation from a tool's JSON Schema, so a bench
 * can drive any tool surface without hand-written cases: numbers sweep
 * their range, enums cycle, strings respect maxLength, optionals toggle,
 * objects and arrays recurse to a bounded depth.
 */

/** A JSON Schema fragment as the generator reads it. */
export interface SchemaLike {
  type?: string | string[]
  properties?: Record<string, SchemaLike>
  required?: string[]
  enum?: unknown[]
  const?: unknown
  default?: unknown
  minimum?: number
  maximum?: number
  exclusiveMinimum?: number
  exclusiveMaximum?: number
  multipleOf?: number
  minLength?: number
  maxLength?: number
  pattern?: string
  format?: string
  items?: SchemaLike
  minItems?: number
  maxItems?: number
  oneOf?: SchemaLike[]
  anyOf?: SchemaLike[]
  allOf?: SchemaLike[]
  additionalProperties?: boolean | SchemaLike
  [key: string]: unknown
}

/** Options for generateInputs. */
export interface GenerateOptions {
  /** how many inputs to produce */
  runs: number
  /** deterministic seed; the same seed and schema give the same inputs */
  seed?: number
  /** recursion depth for nested objects and arrays */
  maxDepth?: number
}

/** mulberry32: small, seedable, good enough for sweeping inputs. */
export function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const WORDS = ["mug", "vase", "planter", "bowl", "tumbler", "round", "tapered", "classic", "hex", "clay"]

const typeOf = (schema: SchemaLike): string => {
  if (schema.const !== undefined) return "const"
  if (schema.enum) return "enum"
  const t = Array.isArray(schema.type) ? schema.type.find((x) => x !== "null") : schema.type
  if (t) return t
  if (schema.properties) return "object"
  if (schema.items) return "array"
  if (schema.oneOf || schema.anyOf) return "union"
  return "string"
}

function numberFor(schema: SchemaLike, i: number, runs: number, integer: boolean): number {
  const min = schema.minimum ?? (schema.exclusiveMinimum !== undefined ? schema.exclusiveMinimum + (integer ? 1 : 0.001) : undefined)
  const max = schema.maximum ?? (schema.exclusiveMaximum !== undefined ? schema.exclusiveMaximum - (integer ? 1 : 0.001) : undefined)
  const lo = min ?? (max !== undefined ? max - 100 : 0)
  const hi = max ?? (min !== undefined ? min + 100 : 100)
  const t = runs <= 1 ? 0.5 : i / (runs - 1)
  let value = lo + (hi - lo) * t
  if (schema.multipleOf) value = Math.round(value / schema.multipleOf) * schema.multipleOf
  if (integer) value = Math.round(value)
  return Math.min(hi, Math.max(lo, value))
}

function stringFor(schema: SchemaLike, i: number, rand: () => number): string {
  if (schema.format === "uri" || schema.format === "url") return `https://example.com/${WORDS[i % WORDS.length]}?run=${i}`
  if (schema.format === "date-time") return new Date(Date.UTC(2026, 0, 1 + (i % 28))).toISOString()
  if (schema.format === "email") return `bench${i}@example.com`
  const max = schema.maxLength ?? 24
  const min = schema.minLength ?? 1
  let s = WORDS[Math.floor(rand() * WORDS.length)]
  while (s.length < min) s += WORDS[Math.floor(rand() * WORDS.length)]
  return s.slice(0, Math.max(min, max))
}

function valueFor(schema: SchemaLike, i: number, runs: number, depth: number, rand: () => number, opts: Required<GenerateOptions>): unknown {
  switch (typeOf(schema)) {
    case "const":
      return schema.const
    case "enum":
      return schema.enum![i % schema.enum!.length]
    case "boolean":
      return i % 2 === 0
    case "integer":
      return numberFor(schema, i, runs, true)
    case "number":
      return numberFor(schema, i, runs, false)
    case "null":
      return null
    case "array": {
      if (depth >= opts.maxDepth) return []
      const n = Math.min(schema.maxItems ?? 3, Math.max(schema.minItems ?? 1, 1 + (i % 3)))
      return Array.from({ length: n }, (_, k) => valueFor(schema.items ?? {}, i + k, runs, depth + 1, rand, opts))
    }
    case "object":
      return objectFor(schema, i, runs, depth + 1, rand, opts)
    case "union": {
      const options = schema.oneOf ?? schema.anyOf ?? []
      return options.length ? valueFor(options[i % options.length], i, runs, depth, rand, opts) : null
    }
    default:
      return schema.default !== undefined && i % 4 === 0 ? schema.default : stringFor(schema, i, rand)
  }
}

function objectFor(schema: SchemaLike, i: number, runs: number, depth: number, rand: () => number, opts: Required<GenerateOptions>): Record<string, unknown> {
  const merged: SchemaLike = schema.allOf ? Object.assign({}, ...schema.allOf, schema) : schema
  const out: Record<string, unknown> = {}
  const required = new Set(merged.required ?? [])
  const props = Object.entries(merged.properties ?? {})
  for (const [key, sub] of props) {
    // optionals are present on even runs and absent on odd ones, so both
    // shapes are exercised; required keys are always present
    if (!required.has(key) && depth > 0 && i % 2 === 1) continue
    if (!required.has(key) && depth === 0 && i % 2 === 1 && props.length > 1) continue
    out[key] = valueFor(sub, i, runs, depth, rand, opts)
  }
  return out
}

/** Produce `runs` inputs for an inputSchema, deterministically under `seed`. */
export function generateInputs(schema: SchemaLike | undefined, options: GenerateOptions): unknown[] {
  const opts: Required<GenerateOptions> = { runs: options.runs, seed: options.seed ?? 1, maxDepth: options.maxDepth ?? 3 }
  const rand = prng(opts.seed)
  const s = schema ?? { type: "object", properties: {} }
  return Array.from({ length: opts.runs }, (_, i) => (typeOf(s) === "object" ? objectFor(s, i, opts.runs, 0, rand, opts) : valueFor(s, i, opts.runs, 0, rand, opts)))
}
