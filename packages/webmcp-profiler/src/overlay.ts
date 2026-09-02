/**
 * webmcp-profiler · overlay — the live panel.
 *
 * A shadow-DOM floating table (no style bleed in or out, no framework):
 * per-tool calls / p50 / p95 / last payload, and the ledger line that
 * answers "where did the time go" — tool compute vs payload weight vs
 * host+model gaps. Also listens on the BroadcastChannel relay, so a
 * visible tab can render spans recorded in a hidden agent tab on the
 * same origin (docs/webmcp-profiler-spec.md §7).
 */

import type { Collector, Span } from "./collector"

const CHANNEL_PREFIX = "webmcp-perf:"

const fmtMs = (ms: number): string => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms.toFixed(1)}ms`)
const fmtBytes = (b: number): string =>
  b >= 1_048_576 ? `${(b / 1_048_576).toFixed(1)}MB` : b >= 1024 ? `${(b / 1024).toFixed(1)}KB` : `${b}B`

export interface Overlay {
  toggle: () => void
  destroy: () => void
}

export function createOverlay(collector: Collector): Overlay {
  const host = document.createElement("div")
  host.style.cssText = "position:fixed;z-index:2147483647;left:8px;bottom:8px;"
  const shadow = host.attachShadow({ mode: "open" })
  shadow.innerHTML = `
    <style>
      .panel{font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;background:rgba(12,12,14,.92);
        color:#e7e5e4;border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:8px 10px;
        max-width:min(440px,calc(100vw - 24px));max-height:45vh;overflow:auto;backdrop-filter:blur(6px)}
      table{border-collapse:collapse;width:100%}
      th,td{text-align:right;padding:1px 0 1px 10px;white-space:nowrap}
      th:first-child,td:first-child{text-align:left;padding-left:0}
      th{color:#a8a29e;font-weight:500;border-bottom:1px solid rgba(255,255,255,.14)}
      .head{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:4px}
      .title{color:#fafaf9;font-weight:600}
      .close{cursor:pointer;color:#a8a29e;background:none;border:none;font:inherit;padding:0}
      .close:hover{color:#fafaf9}
      .ledger{margin-top:5px;color:#a8a29e;border-top:1px solid rgba(255,255,255,.14);padding-top:4px}
      .err{color:#f87171}.remote{color:#93c5fd}
      .empty{color:#a8a29e}
    </style>
    <div class="panel">
      <div class="head">
        <span class="title">webmcp-perf</span>
        <button class="close" title="Hide (reopen with __webmcpPerf.overlay())">×</button>
      </div>
      <div class="body"><span class="empty">waiting for tool calls…</span></div>
      <div class="ledger"></div>
    </div>`
  document.documentElement.appendChild(host)
  shadow.querySelector<HTMLButtonElement>(".close")!.onclick = () => (host.hidden = true)

  // spans relayed from another same-origin tab (a hidden agent browser)
  const remoteSpans: Span[] = []
  let channel: BroadcastChannel | null = null
  try {
    channel = new BroadcastChannel(CHANNEL_PREFIX + location.origin)
    channel.onmessage = (event) => {
      if (event.data?.kind === "span") {
        remoteSpans.push(event.data.span as Span)
        if (remoteSpans.length > 200) remoteSpans.shift()
        scheduleRender()
      }
    }
  } catch {
    /* no BroadcastChannel — local-only overlay */
  }

  const body = shadow.querySelector<HTMLElement>(".body")!
  const ledgerEl = shadow.querySelector<HTMLElement>(".ledger")!

  const render = (): void => {
    const rows = collector.aggregates()
    if (rows.length === 0 && remoteSpans.length === 0) return
    const remoteNote =
      remoteSpans.length > 0
        ? `<div class="remote">+ ${remoteSpans.length} spans relayed from another tab</div>`
        : ""
    body.innerHTML = `
      <table>
        <tr><th>tool</th><th>calls</th><th>p50</th><th>p95</th><th>last result</th></tr>
        ${rows
          .map(
            (r) => `<tr>
              <td>${r.tool}${r.errors ? ` <span class="err">✗${r.errors}</span>` : ""}</td>
              <td>${r.calls}</td><td>${fmtMs(r.p50Ms)}</td><td>${fmtMs(r.p95Ms)}</td>
              <td>${fmtBytes(r.lastResultBytes)}</td>
            </tr>`
          )
          .join("")}
      </table>${remoteNote}`
    const t = collector.ledger.totals
    ledgerEl.textContent =
      `tools ${fmtMs(t.wallMs)} · payloads ${fmtBytes(t.resultBytes)} (~${t.estTokens.toLocaleString()} tok)` +
      ` · host gaps ${fmtMs(t.hostGapMs)}`
  }

  // coalesce bursts — the panel never needs more than ~4 paints a second
  let renderTimer: number | null = null
  const scheduleRender = (): void => {
    if (renderTimer !== null) return
    renderTimer = window.setTimeout(() => {
      renderTimer = null
      render()
    }, 250)
  }

  const unsubscribe = collector.onSpan(scheduleRender)
  render()

  return {
    toggle: () => {
      host.hidden = !host.hidden
      if (!host.hidden) render()
    },
    destroy: () => {
      unsubscribe()
      if (renderTimer !== null) {
        window.clearTimeout(renderTimer)
        renderTimer = null
      }
      channel?.close()
      host.remove()
    },
  }
}
