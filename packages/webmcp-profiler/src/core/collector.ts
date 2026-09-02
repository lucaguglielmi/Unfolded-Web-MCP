/**
 * The span store. A ring buffer of measured tool calls, the session
 * ledger (host timeline, registered tools, running totals), Long-Task
 * attribution, and the versioned report. Environment-free: nothing here
 * assumes a DOM, so it runs in the browser, in Node, and in tests alike.
 */

/** Build-time injected by Vite `define`; falls back for source consumers and tests. */
declare const __WEBMCP_PROFILER_VERSION__: string | undefined
/** The package version this profiler was built from. */
export const PACKAGE_VERSION: string =
  typeof __WEBMCP_PROFILER_VERSION__ === "string" ? __WEBMCP_PROFILER_VERSION__ : "0.0.0-dev"

/** The report document's format identifier; bumped when field meaning changes. */
export const REPORT_FORMAT = "webmcp-perf-report/2"

/** What a token estimate is being asked for. */
export type ContentKind = "text" | "image" | "other" | "input"

/** One part of a payload handed to the token estimator. */
export interface TokenPart {
  kind: ContentKind
  /** UTF-8 bytes of the part's JSON (base64 length for images) */
  bytes: number
  mimeType?: string
}

/** Replaces the default bytes-to-tokens heuristic for every content kind. */
export type TokenEstimator = (part: TokenPart) => number

/** Default heuristic: text and input at 4 bytes per token; images at their decoded size at the same rate. */
export const defaultTokenEstimator: TokenEstimator = ({ kind, bytes }) =>
  kind === "image" ? Math.ceil((bytes * 0.75) / 4) : Math.ceil(bytes / 4)

/** What an error span keeps of a thrown error. */
export type ErrorPolicy = "message" | "name" | "none"

/** One measured tool call. */
export interface Span {
  /** the profiler session that recorded the span; `${sessionId}#${seq}` is its identity */
  sessionId: string
  seq: number
  tool: string
  /** performance.now() timebase */
  invokedAt: number
  settledAt: number
  /** the execute() await, end to end */
  wallMs: number
  /** Long-Task overlap attributed to this call (fills in as entries land; Chromium) */
  blockingMs: number
  /** UTF-8 bytes of the input's JSON */
  inputBytes: number
  /** UTF-8 bytes of the result's JSON */
  resultBytes: number
  /** count per content type, e.g. { text: 1, image: 1 } */
  contentTypes: Record<string, number>
  /** base64 length of image content */
  imageBytes: number
  /** estimated tokens the model wrote to produce the input */
  estInputTokens: number
  /** estimated tokens to read the text and other parts of the result */
  estTextTokens: number
  /** estimated tokens to read the image parts of the result */
  estImageTokens: number
  /** estInputTokens + estTextTokens + estImageTokens */
  estTokens: number
  isError: boolean
  /** per errorPolicy: the message (capped), the error name, or null */
  error: string | null
  /** idle from the previous settle to this invoke; null when the calls overlapped */
  gapSincePrevCallMs: number | null
  /** recorded by the bench rather than a live host */
  synthetic: boolean
  /** false when the result could not be JSON-serialized (bytes then read 0) */
  serializable: boolean
}

/** Fields the wrapper supplies; the collector adds identity and the gap. */
export type RawSpan = Omit<Span, "sessionId" | "seq" | "gapSincePrevCallMs" | "synthetic">

/** A late correction to an already-recorded span. */
export interface SpanUpdate {
  sessionId: string
  seq: number
  blockingMs: number
}

/** What the ledger keeps per registered tool. */
export interface ToolRecord {
  /** UTF-8 bytes of the descriptor's name, title, description, inputSchema, annotations */
  schemaBytes: number
  /** performance.now() when first registered */
  registeredAt: number
  /** performance.now() when unregistered, or null while registered */
  unregisteredAt: number | null
  /** the profiler's own report tool, never measured */
  internal: boolean
}

/** Session running totals. */
export interface LedgerTotals {
  calls: number
  /** calls that ran unmeasured because `sample` excluded them */
  unsampledCalls: number
  /** calls invoked before the previous call settled */
  overlappingCalls: number
  errors: number
  wallMs: number
  blockingMs: number
  resultBytes: number
  estTokens: number
  estInputTokens: number
  /** summed settled-to-next-invoke gaps: host and model wait, by definition */
  hostGapMs: number
  /** descriptor bytes of the currently registered tools, paid in every conversation */
  schemaBytes: number
  estSchemaTokens: number
}

/** The session ledger: host timeline, tool registry, totals. */
export interface Ledger {
  sessionId: string
  /** epoch ms when the profiler attached */
  attachedAt: number
  /** performance.now() offsets, null until observed */
  hostFoundAt: number | null
  hostLocation: string | null
  firstRegistrationAt: number | null
  /** names currently registered */
  registeredTools: string[]
  tools: Record<string, ToolRecord>
  firstCallAt: number | null
  lastSettledAt: number | null
  totals: LedgerTotals
}

/** Per-tool statistics over the buffered spans. */
export interface ToolAggregate {
  tool: string
  calls: number
  errors: number
  minMs: number
  p50Ms: number
  p95Ms: number
  maxMs: number
  blockingMs: number
  lastResultBytes: number
  totalBytes: number
  estTokens: number
  estInputTokens: number
  schemaBytes: number
}

/** The versioned report document. */
export interface PerfReport {
  format: typeof REPORT_FORMAT
  session: {
    id: string
    origin: string | null
    userAgent: string | null
    generatedAt: string
    /** the package version that produced the report */
    version: string
  }
  ledger: Ledger
  tools: ToolAggregate[]
  spans: Span[]
}

/** Options for report(): which spans to include. */
export interface ReportOptions {
  /** false omits spans; a number keeps the newest N; default all buffered */
  spans?: boolean | number
  /** restrict spans and aggregates to one tool */
  tool?: string
}

const NON_ASCII = /[^\x00-\x7f]/

/** UTF-8 byte length of a string without allocating an encoded copy. */
export function utf8Length(str: string): number {
  if (!NON_ASCII.test(str)) return str.length
  let bytes = 0
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4
      i++
    } else bytes += 3
  }
  return bytes
}

/** Eight hex characters from the platform's random source. */
export function newSessionId(): string {
  const c = typeof crypto !== "undefined" ? crypto : undefined
  if (c?.getRandomValues) {
    const bytes = new Uint8Array(4)
    c.getRandomValues(bytes)
    return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")
  }
  return Math.floor(Math.random() * 0xffffffff)
    .toString(16)
    .padStart(8, "0")
}

const quantile = (sorted: number[], p: number): number =>
  sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]

/** Per-tool aggregates over any span list; the overlay uses it for relayed sessions too. */
export function aggregateSpans(
  spans: readonly Span[],
  tools: Record<string, ToolRecord> = {}
): ToolAggregate[] {
  const byTool = new Map<string, Span[]>()
  for (const span of spans) {
    const list = byTool.get(span.tool) ?? []
    list.push(span)
    byTool.set(span.tool, list)
  }
  return [...byTool.entries()].map(([tool, list]) => {
    const durations = list.map((s) => s.wallMs).sort((a, b) => a - b)
    return {
      tool,
      calls: list.length,
      errors: list.filter((s) => s.isError).length,
      minMs: durations[0],
      p50Ms: quantile(durations, 0.5),
      p95Ms: quantile(durations, 0.95),
      maxMs: durations[durations.length - 1],
      blockingMs: list.reduce((sum, s) => sum + s.blockingMs, 0),
      lastResultBytes: list[list.length - 1].resultBytes,
      totalBytes: list.reduce((sum, s) => sum + s.resultBytes, 0),
      estTokens: list.reduce((sum, s) => sum + s.estTokens, 0),
      estInputTokens: list.reduce((sum, s) => sum + s.estInputTokens, 0),
      schemaBytes: tools[tool]?.schemaBytes ?? 0,
    }
  })
}

/** Totals a span list supports on its own (no schema or sampling knowledge). */
export function totalsFromSpans(
  spans: readonly Span[]
): Pick<
  LedgerTotals,
  "calls" | "errors" | "wallMs" | "blockingMs" | "resultBytes" | "estTokens" | "estInputTokens" | "hostGapMs"
> {
  const t = { calls: 0, errors: 0, wallMs: 0, blockingMs: 0, resultBytes: 0, estTokens: 0, estInputTokens: 0, hostGapMs: 0 }
  for (const s of spans) {
    t.calls++
    if (s.isError) t.errors++
    t.wallMs += s.wallMs
    t.blockingMs += s.blockingMs
    t.resultBytes += s.resultBytes
    t.estTokens += s.estTokens
    t.estInputTokens += s.estInputTokens
    if (s.gapSincePrevCallMs !== null && s.gapSincePrevCallMs > 0) t.hostGapMs += s.gapSincePrevCallMs
  }
  return t
}

const measureName = (tool: string, seq: number): string => `webmcp:${tool}#${seq}`

const emptyTotals = (): LedgerTotals => ({
  calls: 0,
  unsampledCalls: 0,
  overlappingCalls: 0,
  errors: 0,
  wallMs: 0,
  blockingMs: 0,
  resultBytes: 0,
  estTokens: 0,
  estInputTokens: 0,
  hostGapMs: 0,
  schemaBytes: 0,
  estSchemaTokens: 0,
})

/** Options for the collector. */
export interface CollectorOptions {
  bufferSize?: number
  sessionId?: string
  tokenEstimator?: TokenEstimator
}

/** The span store, ledger, and Long-Task attribution for one profiler session. */
export class Collector {
  private spanBuffer: Span[] = []
  private seq = 0
  private listeners = new Set<(span: Span) => void>()
  private updateListeners = new Set<(update: SpanUpdate) => void>()
  private longTaskObserver: PerformanceObserver | null = null
  /** stamped on spans recorded while true (the bench sets it) */
  synthetic = false
  readonly tokenEstimator: TokenEstimator
  readonly ledger: Ledger
  private readonly bufferSize: number

  constructor(options: CollectorOptions | number = {}) {
    const opts = typeof options === "number" ? { bufferSize: options } : options
    this.bufferSize = opts.bufferSize ?? 500
    this.tokenEstimator = opts.tokenEstimator ?? defaultTokenEstimator
    this.ledger = {
      sessionId: opts.sessionId ?? newSessionId(),
      attachedAt: Date.now(),
      hostFoundAt: null,
      hostLocation: null,
      firstRegistrationAt: null,
      registeredTools: [],
      tools: {},
      firstCallAt: null,
      lastSettledAt: null,
      totals: emptyTotals(),
    }
    try {
      this.longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) this.attributeLongTask(entry.startTime, entry.startTime + entry.duration)
      })
      this.longTaskObserver.observe({ type: "longtask", buffered: false })
    } catch {
      /* longtask observation is Chromium-only: blockingMs stays 0 elsewhere */
    }
  }

  /**
   * Long Tasks land after the task ends, so attribution is lazy: each
   * span overlapping the task gets its own overlap, while the ledger
   * total counts the task's overlap with the union of those windows so
   * concurrent calls are not double-counted.
   */
  attributeLongTask(start: number, end: number): void {
    const touched: Span[] = []
    for (let i = this.spanBuffer.length - 1; i >= 0; i--) {
      const span = this.spanBuffer[i]
      if (span.settledAt < start - 2000) break
      const overlap = Math.min(end, span.settledAt) - Math.max(start, span.invokedAt)
      if (overlap > 0) {
        span.blockingMs += overlap
        touched.push(span)
      }
    }
    if (touched.length === 0) return
    const windows = touched
      .map((s) => [Math.max(start, s.invokedAt), Math.min(end, s.settledAt)] as [number, number])
      .sort((a, b) => a[0] - b[0])
    let union = 0
    let [curStart, curEnd] = windows[0]
    for (let i = 1; i < windows.length; i++) {
      const [s, e] = windows[i]
      if (s <= curEnd) curEnd = Math.max(curEnd, e)
      else {
        union += curEnd - curStart
        ;[curStart, curEnd] = [s, e]
      }
    }
    union += curEnd - curStart
    this.ledger.totals.blockingMs += union
    for (const span of touched) {
      const update = { sessionId: span.sessionId, seq: span.seq, blockingMs: span.blockingMs }
      for (const listener of this.updateListeners) listener(update)
    }
  }

  /** Subscribe to spans as they settle; returns unsubscribe. */
  onSpan(listener: (span: Span) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Subscribe to late corrections (Long-Task attribution); returns unsubscribe. */
  onUpdate(listener: (update: SpanUpdate) => void): () => void {
    this.updateListeners.add(listener)
    return () => this.updateListeners.delete(listener)
  }

  hostFound(location: string): void {
    if (this.ledger.hostFoundAt === null) {
      this.ledger.hostFoundAt = performance.now()
      this.ledger.hostLocation = location
    }
  }

  toolRegistered(name: string, schemaBytes = 0, internal = false): void {
    const now = performance.now()
    if (this.ledger.firstRegistrationAt === null) this.ledger.firstRegistrationAt = now
    const existing = this.ledger.tools[name]
    if (existing && existing.unregisteredAt === null) {
      existing.schemaBytes = schemaBytes
      existing.internal = internal
    } else {
      this.ledger.tools[name] = { schemaBytes, registeredAt: now, unregisteredAt: null, internal }
    }
    if (!this.ledger.registeredTools.includes(name)) this.ledger.registeredTools.push(name)
    this.recomputeSchemaTotals()
  }

  toolUnregistered(name: string): void {
    const record = this.ledger.tools[name]
    if (!record || record.unregisteredAt !== null) return
    record.unregisteredAt = performance.now()
    this.ledger.registeredTools = this.ledger.registeredTools.filter((n) => n !== name)
    this.recomputeSchemaTotals()
  }

  /**
   * Reconcile the registered names with what the host reports (getTools /
   * toolchange). `issuedAt` is when the host was asked: a tool registered
   * after that (a re-registration racing a stale answer) is left alone.
   */
  reconcileRegistered(names: readonly string[], issuedAt = Number.POSITIVE_INFINITY): void {
    for (const name of [...this.ledger.registeredTools]) {
      if (names.includes(name)) continue
      const record = this.ledger.tools[name]
      // >=: performance.now() is coarsened in browsers, and a registration in
      // the same tick as the query must count as newer than the answer
      if (record && record.registeredAt >= issuedAt) continue
      this.toolUnregistered(name)
    }
  }

  private recomputeSchemaTotals(): void {
    let bytes = 0
    for (const name of this.ledger.registeredTools) bytes += this.ledger.tools[name]?.schemaBytes ?? 0
    this.ledger.totals.schemaBytes = bytes
    this.ledger.totals.estSchemaTokens = this.tokenEstimator({ kind: "text", bytes })
  }

  /** A call that ran unmeasured because sampling excluded it. */
  recordUnsampled(): void {
    this.ledger.totals.calls += 1
    this.ledger.totals.unsampledCalls += 1
  }

  record(raw: RawSpan): Span {
    const overlapped = this.ledger.lastSettledAt !== null && raw.invokedAt < this.ledger.lastSettledAt
    const gap = this.ledger.lastSettledAt === null || overlapped ? null : raw.invokedAt - this.ledger.lastSettledAt
    const full: Span = {
      ...raw,
      sessionId: this.ledger.sessionId,
      seq: this.seq++,
      gapSincePrevCallMs: gap,
      synthetic: this.synthetic,
    }

    this.spanBuffer.push(full)
    if (this.spanBuffer.length > this.bufferSize) {
      const evicted = this.spanBuffer.shift()!
      try {
        performance.clearMeasures(measureName(evicted.tool, evicted.seq))
      } catch {
        /* no measures to clear on this platform */
      }
    }

    const t = this.ledger.totals
    t.calls += 1
    t.wallMs += full.wallMs
    t.resultBytes += full.resultBytes
    t.estTokens += full.estTokens
    t.estInputTokens += full.estInputTokens
    if (full.isError) t.errors += 1
    if (overlapped) t.overlappingCalls += 1
    if (gap !== null && gap > 0) t.hostGapMs += gap
    if (this.ledger.firstCallAt === null) this.ledger.firstCallAt = full.invokedAt
    this.ledger.lastSettledAt = Math.max(this.ledger.lastSettledAt ?? 0, full.settledAt)

    try {
      performance.measure(measureName(full.tool, full.seq), { start: full.invokedAt, end: full.settledAt })
    } catch {
      /* older measure() signatures: marks are a nicety, not a dependency */
    }

    for (const listener of this.listeners) {
      try {
        listener(full)
      } catch (error) {
        console.error("[webmcp-perf] onSpan listener threw", error)
      }
    }
    return full
  }

  spans(): readonly Span[] {
    return this.spanBuffer
  }

  aggregates(tool?: string): ToolAggregate[] {
    const spans = tool ? this.spanBuffer.filter((s) => s.tool === tool) : this.spanBuffer
    return aggregateSpans(spans, this.ledger.tools)
  }

  report(options: ReportOptions = {}): PerfReport {
    let spans = options.tool ? this.spanBuffer.filter((s) => s.tool === options.tool) : this.spanBuffer
    if (options.spans === false) spans = []
    else if (typeof options.spans === "number") spans = spans.slice(-Math.max(0, options.spans))
    return {
      format: REPORT_FORMAT,
      session: {
        id: this.ledger.sessionId,
        origin: typeof location === "undefined" ? null : location.origin,
        userAgent: typeof navigator === "undefined" ? null : navigator.userAgent,
        generatedAt: new Date().toISOString(),
        version: PACKAGE_VERSION,
      },
      ledger: this.ledger,
      tools: this.aggregates(options.tool),
      spans: [...spans],
    }
  }

  private clearAllMeasures(): void {
    try {
      for (const span of this.spanBuffer) performance.clearMeasures(measureName(span.tool, span.seq))
    } catch {
      /* nothing to clear */
    }
  }

  reset(): void {
    this.clearAllMeasures()
    this.spanBuffer = []
    const schema = { schemaBytes: this.ledger.totals.schemaBytes, estSchemaTokens: this.ledger.totals.estSchemaTokens }
    this.ledger.totals = { ...emptyTotals(), ...schema }
    this.ledger.firstCallAt = null
    this.ledger.lastSettledAt = null
  }

  dispose(): void {
    this.clearAllMeasures()
    this.longTaskObserver?.disconnect()
    this.listeners.clear()
    this.updateListeners.clear()
  }
}
