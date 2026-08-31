/**
 * webmcp-profiler · collector — the span store.
 *
 * Everything above this layer (overlay, console API, relay) is a view
 * over the ring buffer and ledger kept here; nothing here knows the app,
 * the framework, or even that a DOM exists. Spec:
 * docs/webmcp-profiler-spec.md §3–§5.
 */

export interface Span {
  seq: number
  tool: string
  /** performance.now() timebase */
  invokedAt: number
  settledAt: number
  wallMs: number
  /** Long-Task overlap attributed to this call (fills in as entries land) */
  blockingMs: number
  inputBytes: number
  resultBytes: number
  /** count per content type, e.g. { text: 1, image: 1 } */
  contentTypes: Record<string, number>
  imageBytes: number
  /** bytes/4 heuristic — the model-side cost of reading this result */
  estTokens: number
  isError: boolean
  /** settled-to-next-invoke idle before this call: host + model think time */
  gapSincePrevCallMs: number | null
  error: string | null
  synthetic: boolean
}

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
}

export interface Ledger {
  /** epoch ms when the profiler attached */
  attachedAt: number
  /** performance.now() offsets, null until observed */
  hostFoundAt: number | null
  hostLocation: string | null
  firstRegistrationAt: number | null
  registeredTools: string[]
  firstCallAt: number | null
  lastSettledAt: number | null
  totals: {
    calls: number
    errors: number
    wallMs: number
    blockingMs: number
    resultBytes: number
    estTokens: number
    /** summed settled→next-invoke gaps — host/model wait, by definition */
    hostGapMs: number
  }
}

export const REPORT_FORMAT = "webmcp-perf-report/1"

const quantile = (sorted: number[], p: number): number =>
  sorted.length === 0
    ? 0
    : sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]

export class Collector {
  private spanBuffer: Span[] = []
  private seq = 0
  private listeners = new Set<(span: Span) => void>()
  private longTaskObserver: PerformanceObserver | null = null

  readonly ledger: Ledger = {
    attachedAt: Date.now(),
    hostFoundAt: null,
    hostLocation: null,
    firstRegistrationAt: null,
    registeredTools: [],
    firstCallAt: null,
    lastSettledAt: null,
    totals: {
      calls: 0,
      errors: 0,
      wallMs: 0,
      blockingMs: 0,
      resultBytes: 0,
      estTokens: 0,
      hostGapMs: 0,
    },
  }

  private readonly bufferSize: number

  constructor(bufferSize = 500) {
    this.bufferSize = bufferSize
    // Long Tasks land AFTER the task ends, so attribution is lazy: each
    // entry is walked back over recent spans and its overlap added.
    try {
      this.longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const start = entry.startTime
          const end = entry.startTime + entry.duration
          for (let i = this.spanBuffer.length - 1; i >= 0; i--) {
            const span = this.spanBuffer[i]
            if (span.settledAt < start - 2000) break
            const overlap = Math.min(end, span.settledAt) - Math.max(start, span.invokedAt)
            if (overlap > 0) {
              span.blockingMs += overlap
              this.ledger.totals.blockingMs += overlap
            }
          }
        }
      })
      this.longTaskObserver.observe({ type: "longtask", buffered: false })
    } catch {
      /* longtask observation is Chromium-only — blockingMs stays 0 */
    }
  }

  onSpan(listener: (span: Span) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  hostFound(location: string): void {
    if (this.ledger.hostFoundAt === null) {
      this.ledger.hostFoundAt = performance.now()
      this.ledger.hostLocation = location
    }
  }

  toolRegistered(name: string): void {
    if (this.ledger.firstRegistrationAt === null) {
      this.ledger.firstRegistrationAt = performance.now()
    }
    if (!this.ledger.registeredTools.includes(name)) {
      this.ledger.registeredTools.push(name)
    }
  }

  record(span: Omit<Span, "seq" | "gapSincePrevCallMs">): Span {
    const gap =
      this.ledger.lastSettledAt === null ? null : span.invokedAt - this.ledger.lastSettledAt
    const full: Span = { ...span, seq: this.seq++, gapSincePrevCallMs: gap }

    this.spanBuffer.push(full)
    if (this.spanBuffer.length > this.bufferSize) this.spanBuffer.shift()

    const t = this.ledger.totals
    t.calls += 1
    t.wallMs += full.wallMs
    t.resultBytes += full.resultBytes
    t.estTokens += full.estTokens
    if (full.isError) t.errors += 1
    if (gap !== null && gap > 0) t.hostGapMs += gap
    if (this.ledger.firstCallAt === null) this.ledger.firstCallAt = full.invokedAt
    this.ledger.lastSettledAt = full.settledAt

    // free DevTools integration: the call shows up in the Performance panel
    try {
      performance.measure(`webmcp:${full.tool}#${full.seq}`, {
        start: full.invokedAt,
        end: full.settledAt,
      })
    } catch {
      /* older measure() signatures — marks are a nicety, not a dependency */
    }

    for (const listener of this.listeners) listener(full)
    return full
  }

  spans(): readonly Span[] {
    return this.spanBuffer
  }

  aggregates(): ToolAggregate[] {
    const byTool = new Map<string, Span[]>()
    for (const span of this.spanBuffer) {
      const list = byTool.get(span.tool) ?? []
      list.push(span)
      byTool.set(span.tool, list)
    }
    return [...byTool.entries()].map(([tool, spans]) => {
      const durations = spans.map((s) => s.wallMs).sort((a, b) => a - b)
      return {
        tool,
        calls: spans.length,
        errors: spans.filter((s) => s.isError).length,
        minMs: durations[0],
        p50Ms: quantile(durations, 0.5),
        p95Ms: quantile(durations, 0.95),
        maxMs: durations[durations.length - 1],
        blockingMs: spans.reduce((sum, s) => sum + s.blockingMs, 0),
        lastResultBytes: spans[spans.length - 1].resultBytes,
        totalBytes: spans.reduce((sum, s) => sum + s.resultBytes, 0),
        estTokens: spans.reduce((sum, s) => sum + s.estTokens, 0),
      }
    })
  }

  report(): Record<string, unknown> {
    return {
      format: REPORT_FORMAT,
      session: {
        origin: typeof location === "undefined" ? null : location.origin,
        userAgent: typeof navigator === "undefined" ? null : navigator.userAgent,
        generatedAt: new Date().toISOString(),
      },
      ledger: this.ledger,
      tools: this.aggregates(),
      spans: this.spanBuffer,
    }
  }

  reset(): void {
    this.spanBuffer = []
    const t = this.ledger.totals
    t.calls = t.errors = t.wallMs = t.blockingMs = t.resultBytes = t.estTokens = t.hostGapMs = 0
    this.ledger.firstCallAt = null
    this.ledger.lastSettledAt = null
  }

  dispose(): void {
    this.longTaskObserver?.disconnect()
    this.listeners.clear()
  }
}
