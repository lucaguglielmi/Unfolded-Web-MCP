import { useEffect, useState } from "react"
import { ArrowUpRight, Check, Copy, X } from "lucide-react"
import { LogoMark } from "@/components/LogoMark"
import { useProjectStore } from "@/store/useProjectStore"
import { useDesignHref } from "@/lib/useStudioHref"

/**
 * A one-time, dismissible nudge for Chrome users: Chrome ships WebMCP
 * behind a documented flag (chrome://flags/#enable-webmcp-testing), so if
 * we're clearly in Chrome and no WebMCP host showed up, point the person
 * at it.
 *
 * This is a HINT, not a connection claim — the status pill's rule of never
 * inferring a connection from the user agent is untouched. Browser sniffing
 * here only decides whether the tip is worth showing, and it errs on the
 * side of silence: Chromium cousins (Edge, Opera, Samsung), iOS Chrome (a
 * WebKit shell with no flags), Android WebViews (in-app browsers such as
 * ChatGPT's), and headless browsers are all excluded.
 *
 * Pages can't link to chrome:// URLs, so the flag address is offered as
 * copyable text instead of a link.
 */

const DISMISS_KEY = "unfolded:chrome-flag-nudge-dismissed"
const FLAG_URL = "chrome://flags/#enable-webmcp-testing"
/** wait out the fast registration window so we don't flash before a host appears */
const SHOW_DELAY_MS = 3000

function isRealChrome(): boolean {
  if (typeof navigator === "undefined") return false
  const uaData = (
    navigator as Navigator & {
      userAgentData?: { brands?: { brand: string }[] }
    }
  ).userAgentData
  if (uaData?.brands?.length) {
    const brands = uaData.brands.map((b) => b.brand)
    if (brands.includes("Android WebView")) return false
    return brands.includes("Google Chrome")
  }
  const ua = navigator.userAgent
  return /Chrome\//.test(ua) && !/Headless|Edg\/|OPR\/|SamsungBrowser|CriOS|; wv\)/.test(ua)
}

export function ChromeFlagNudge() {
  const webmcpHref = useDesignHref("/webmcp")
  const agentStatus = useProjectStore((s) => s.agentStatus)
  const [visible, setVisible] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!isRealChrome()) return
    try {
      if (window.localStorage.getItem(DISMISS_KEY)) return
    } catch {
      /* blocked storage — still show, just don't remember */
    }
    const timer = window.setTimeout(() => {
      if (useProjectStore.getState().agentStatus === "unavailable") setVisible(true)
    }, SHOW_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [])

  // a host appearing later (or an agent-minted link state) retires the tip
  if (!visible || agentStatus !== "unavailable") return null

  const dismiss = () => {
    setVisible(false)
    try {
      window.localStorage.setItem(DISMISS_KEY, "1")
    } catch {
      /* best effort */
    }
  }

  const copyFlagUrl = async () => {
    try {
      await navigator.clipboard.writeText(FLAG_URL)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      window.prompt("Copy this address into a new tab:", FLAG_URL)
    }
  }

  return (
    <div
      role="status"
      className="rise-in bg-background fixed right-4 bottom-24 left-4 z-40 rounded-xl border p-4 shadow-lg sm:left-auto sm:w-96 lg:bottom-4"
    >
      <div className="flex items-start gap-3">
        <LogoMark className="mt-0.5 h-5 w-auto shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold tracking-tight">Your AI can use this app</p>
          <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
            This looks like Chrome — WebMCP is one experimental flag away. Copy the address
            below into a new tab, enable <span className="font-medium">WebMCP testing</span>,
            and relaunch Chrome. (Only agents need the flag — following a design live from
            another screen works in any browser, via the two-screens icon.)
          </p>
          <div className="bg-muted mt-2.5 flex items-center gap-1.5 rounded-md py-1 pr-1 pl-2.5">
            <code className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-[11px]">
              {FLAG_URL}
            </code>
            <button
              type="button"
              onClick={copyFlagUrl}
              aria-label="Copy flag address"
              className="text-foreground hover:bg-background flex size-7 shrink-0 items-center justify-center rounded transition-colors"
            >
              {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
            </button>
          </div>
          <div className="mt-2.5 flex items-center gap-3">
            <a
              href={webmcpHref}
              className="text-foreground inline-flex items-center gap-1 text-xs font-medium hover:underline"
            >
              How it works <ArrowUpRight className="size-3" />
            </a>
            <button
              type="button"
              onClick={dismiss}
              className="text-muted-foreground hover:text-foreground text-xs transition-colors"
            >
              No thanks
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="text-muted-foreground hover:text-foreground -mt-1 -mr-1 rounded p-1 transition-colors"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  )
}
