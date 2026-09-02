/**
 * The live panel: a shadow-DOM floating table (no style bleed in or out,
 * no framework) with the per-tool rows and the ledger line that answers
 * "where did the time go". Also listens on the relay, so a visible tab
 * renders the sessions of hidden same-origin tabs, each with its own
 * table. Renders only while visible and only the rows that changed.
 */

import { aggregateSpans, totalsFromSpans, type Collector, type Span, type SpanUpdate, type ToolAggregate } from "./core/collector"
import { fmtBytes, fmtMs, fmtSplit } from "./core/format"
import type { ProfilerStatus } from "./index"

/** The overlay handle. */
export interface Overlay {
  toggle: () => void
  destroy: () => void
}

/** What the overlay needs from the profiler. */
export interface OverlayOptions {
  status: () => ProfilerStatus
  /** relay channel name, or false for a local-only panel */
  channel: string | false
}

const MAX_REMOTE_SESSIONS = 8
const MAX_MESSAGES_PER_SECOND = 1000
const SESSION_ID = /^[0-9a-f]{8}$/
const REMOTE_BUFFER = 500

const CSS = `
  .panel{font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;background:rgba(12,12,14,.92);
    color:#e7e5e4;border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:8px 10px;
    max-width:min(460px,calc(100vw - 24px));max-height:45vh;overflow:auto;backdrop-filter:blur(6px)}
  @media (prefers-reduced-motion: reduce){.panel{backdrop-filter:none;background:rgba(12,12,14,.97)}}
  table{border-collapse:collapse;width:100%}
  th,td{text-align:right;padding:1px 0 1px 10px;white-space:nowrap}
  th:first-child,td:first-child{text-align:left;padding-left:0}
  th{color:#a8a29e;font-weight:500;border-bottom:1px solid rgba(255,255,255,.14)}
  .head{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:4px}
  .title{color:#fafaf9;font-weight:600}
  .close{cursor:pointer;color:#a8a29e;background:none;border:none;font:inherit;padding:0 4px;border-radius:4px}
  .close:hover{color:#fafaf9}
  .close:focus-visible{outline:2px solid #93c5fd;outline-offset:1px}
  .ledger{margin-top:5px;color:#a8a29e;border-top:1px solid rgba(255,255,255,.14);padding-top:4px}
  .err{color:#f87171}.remote{color:#93c5fd;margin-top:6px}
  .status{color:#a8a29e}
`

const isFinite_ = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

/** Accept only well-formed relay messages; everything else is dropped. */
export function validRelayMessage(data: unknown): { kind: "span"; span: Span } | { kind: "update"; update: SpanUpdate } | null {
  if (!data || typeof data !== "object") return null
  const d = data as Record<string, unknown>
  if (d.kind === "update") {
    if (typeof d.sessionId !== "string" || !SESSION_ID.test(d.sessionId)) return null
    if (!Number.isInteger(d.seq) || (d.seq as number) < 0 || !isFinite_(d.blockingMs)) return null
    return { kind: "update", update: { sessionId: d.sessionId, seq: d.seq as number, blockingMs: d.blockingMs } }
  }
  if (d.kind !== "span" || !d.span || typeof d.span !== "object") return null
  const s = d.span as Record<string, unknown>
  if (typeof s.sessionId !== "string" || !SESSION_ID.test(s.sessionId)) return null
  if (!Number.isInteger(s.seq) || (s.seq as number) < 0) return null
  if (typeof s.tool !== "string" || s.tool.length === 0 || s.tool.length > 128) return null
  const numeric = [
    "invokedAt", "settledAt", "wallMs", "blockingMs", "inputBytes", "resultBytes", "imageBytes",
    "estInputTokens", "estTextTokens", "estImageTokens", "estTokens",
  ] as const
  for (const key of numeric) if (!isFinite_(s[key])) return null
  if (s.gapSincePrevCallMs !== null && s.gapSincePrevCallMs !== undefined && !isFinite_(s.gapSincePrevCallMs)) return null
  const contentTypes: Record<string, number> = {}
  if (s.contentTypes && typeof s.contentTypes === "object") {
    const entries = Object.entries(s.contentTypes as Record<string, unknown>)
    if (entries.length > 16) return null
    for (const [k, v] of entries) if (typeof k === "string" && k.length <= 32 && isFinite_(v)) contentTypes[k] = v
  }
  const span: Span = {
    sessionId: s.sessionId,
    seq: s.seq as number,
    tool: s.tool,
    invokedAt: s.invokedAt as number,
    settledAt: s.settledAt as number,
    wallMs: s.wallMs as number,
    blockingMs: s.blockingMs as number,
    inputBytes: s.inputBytes as number,
    resultBytes: s.resultBytes as number,
    contentTypes,
    imageBytes: s.imageBytes as number,
    estInputTokens: s.estInputTokens as number,
    estTextTokens: s.estTextTokens as number,
    estImageTokens: s.estImageTokens as number,
    estTokens: s.estTokens as number,
    isError: s.isError === true,
    error: typeof s.error === "string" ? s.error.slice(0, 200) : null,
    gapSincePrevCallMs: isFinite_(s.gapSincePrevCallMs) ? s.gapSincePrevCallMs : null,
    synthetic: s.synthetic === true,
    serializable: s.serializable !== false,
  }
  return { kind: "span", span }
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const cell = (row: HTMLTableRowElement, text: string, className?: string): void => {
  row.appendChild(el("td", className, text))
}

/** One table (local or one remote session) with incremental row updates. */
class Table {
  readonly root = el("div")
  private readonly table = el("table")
  private readonly rows = new Map<string, { row: HTMLTableRowElement; calls: number; errors: number; bytes: number }>()
  private readonly ledgerEl: HTMLElement

  constructor(title: string | null) {
    if (title) this.root.appendChild(el("div", "remote", title))
    const head = el("tr")
    for (const h of ["tool", "calls", "p50", "p95", "last result"]) head.appendChild(el("th", undefined, h))
    this.table.appendChild(head)
    this.root.appendChild(this.table)
    this.ledgerEl = el("div", "ledger")
    this.ledgerEl.setAttribute("aria-live", "polite")
    this.root.appendChild(this.ledgerEl)
  }

  render(aggregates: ToolAggregate[], ledgerLine: string): void {
    const seen = new Set<string>()
    for (const a of aggregates) {
      seen.add(a.tool)
      const existing = this.rows.get(a.tool)
      if (existing && existing.calls === a.calls && existing.errors === a.errors && existing.bytes === a.lastResultBytes) continue
      const row = el("tr")
      const name = el("td", undefined, a.tool)
      if (a.errors) name.appendChild(el("span", "err", ` ✗${a.errors}`))
      row.appendChild(name)
      cell(row, String(a.calls))
      cell(row, fmtMs(a.p50Ms))
      cell(row, fmtMs(a.p95Ms))
      cell(row, fmtBytes(a.lastResultBytes))
      if (existing) existing.row.replaceWith(row)
      else this.table.appendChild(row)
      this.rows.set(a.tool, { row, calls: a.calls, errors: a.errors, bytes: a.lastResultBytes })
    }
    for (const [tool, entry] of this.rows) {
      if (!seen.has(tool)) {
        entry.row.remove()
        this.rows.delete(tool)
      }
    }
    this.ledgerEl.textContent = ledgerLine
  }
}

/** Build the panel; it renders on span and update events while visible. */
export function createOverlay(collector: Collector, options: OverlayOptions): Overlay {
  const host = el("div")
  host.style.cssText = "position:fixed;z-index:2147483647;left:8px;bottom:8px;"
  const shadow = host.attachShadow({ mode: "open" })

  let styled = false
  try {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(CSS)
    shadow.adoptedStyleSheets = [sheet]
    styled = true
  } catch {
    styled = false
  }
  if (!styled) {
    const style = el("style")
    style.textContent = CSS
    shadow.appendChild(style)
  }

  const panel = el("div", "panel")
  panel.setAttribute("role", "region")
  panel.setAttribute("aria-label", "WebMCP profiler")
  const head = el("div", "head")
  head.appendChild(el("span", "title", "webmcp-perf"))
  const close = el("button", "close", "×")
  close.title = "Hide (reopen with the profiler's overlay() method)"
  close.setAttribute("aria-label", "Hide the profiler panel")
  close.onclick = () => (host.hidden = true)
  head.appendChild(close)
  panel.appendChild(head)
  const statusEl = el("div", "status")
  panel.appendChild(statusEl)
  const local = new Table(null)
  local.root.hidden = true
  panel.appendChild(local.root)
  const remoteRoot = el("div")
  panel.appendChild(remoteRoot)
  shadow.appendChild(panel)
  document.documentElement.appendChild(host)

  // spans relayed from other same-origin tabs, one table per session
  const remote = new Map<string, { spans: Span[]; table: Table; updatedAt: number }>()
  let channel: BroadcastChannel | null = null
  let windowStart = 0
  let windowCount = 0
  const accept = (): boolean => {
    const now = Date.now()
    if (now - windowStart >= 1000) {
      windowStart = now
      windowCount = 0
    }
    return ++windowCount <= MAX_MESSAGES_PER_SECOND
  }
  if (options.channel !== false) {
    try {
      channel = new BroadcastChannel(options.channel)
      channel.onmessage = (event) => {
        if (!accept()) return
        const msg = validRelayMessage(event.data)
        if (!msg) return
        if (msg.kind === "span") {
          if (msg.span.sessionId === collector.ledger.sessionId) return
          let session = remote.get(msg.span.sessionId)
          if (!session) {
            if (remote.size >= MAX_REMOTE_SESSIONS) {
              const oldest = [...remote.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt)[0]
              oldest[1].table.root.remove()
              remote.delete(oldest[0])
            }
            session = { spans: [], table: new Table(`relayed · ${msg.span.sessionId}`), updatedAt: 0 }
            remote.set(msg.span.sessionId, session)
            remoteRoot.appendChild(session.table.root)
          }
          session.spans.push(msg.span)
          if (session.spans.length > REMOTE_BUFFER) session.spans.shift()
          session.updatedAt = Date.now()
        } else {
          const session = remote.get(msg.update.sessionId)
          const span = session?.spans.find((s) => s.seq === msg.update.seq)
          if (span) span.blockingMs = msg.update.blockingMs
        }
        scheduleRender()
      }
    } catch {
      /* no BroadcastChannel: local-only overlay */
    }
  }

  const render = (): void => {
    if (host.hidden || document.visibilityState === "hidden") return
    const rows = collector.aggregates()
    const s = options.status()
    statusEl.textContent = rows.length === 0 ? s.message : ""
    statusEl.hidden = rows.length !== 0
    local.root.hidden = rows.length === 0
    if (rows.length) local.render(rows, fmtSplit(collector.ledger.totals))
    for (const session of remote.values()) {
      session.table.render(aggregateSpans(session.spans), fmtSplit(totalsFromSpans(session.spans)))
    }
  }

  // coalesce bursts: the panel never needs more than ~4 paints a second
  let renderTimer: number | null = null
  const scheduleRender = (): void => {
    if (renderTimer !== null) return
    renderTimer = window.setTimeout(() => {
      renderTimer = null
      render()
    }, 250)
  }
  const onVisible = (): void => {
    if (document.visibilityState === "visible") render()
  }
  document.addEventListener("visibilitychange", onVisible)

  const unsubscribe = collector.onSpan(scheduleRender)
  const unsubscribeUpdate = collector.onUpdate(scheduleRender)
  render()

  return {
    toggle: () => {
      host.hidden = !host.hidden
      if (!host.hidden) render()
    },
    destroy: () => {
      unsubscribe()
      unsubscribeUpdate()
      document.removeEventListener("visibilitychange", onVisible)
      if (renderTimer !== null) {
        window.clearTimeout(renderTimer)
        renderTimer = null
      }
      channel?.close()
      host.remove()
    },
  }
}
