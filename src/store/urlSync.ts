import { buildShareParams, parseShareParams } from "@/lib/model/shareLink"
import { useProjectStore } from "./useProjectStore"

/**
 * Apply a share link from the address bar — call once at boot, before
 * first render, so a deep-linked design never flashes the default.
 */
export function applyShareLinkFromLocation(): void {
  if (typeof window === "undefined" || !window.location.search) return
  const search = window.location.search
  useProjectStore.getState().openModel(parseShareParams(search))
  // Agent-minted links carry via=chatgpt: an explicit signal that this
  // design is open in the internal browser of a ChatGPT conversation.
  // Direct WebMCP registration ("native") always outranks it.
  if (new URLSearchParams(search).get("via") === "chatgpt") {
    useProjectStore.setState((state) =>
      state.agentStatus === "native" ? {} : { agentStatus: "chatgpt" }
    )
  }
}

/**
 * Keep the address bar in sync with the design (debounced replaceState),
 * so the URL is always a live share link. A clean URL stays clean until
 * the first actual edit — visitors aren't surprised by a growing URL.
 */
export function startShareLinkSync(): void {
  if (typeof window === "undefined") return
  const currentQs = () => {
    const { form, clay, paperSize, unit } = useProjectStore.getState()
    return buildShareParams(form, clay, paperSize, unit).toString()
  }
  let last = currentQs()
  let timer: number | undefined
  useProjectStore.subscribe(() => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      const qs = currentQs()
      if (qs === last) return
      last = qs
      window.history.replaceState(null, "", `${window.location.pathname}?${qs}`)
    }, 350)
  })
}
