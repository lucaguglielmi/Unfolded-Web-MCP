import { buildShareParams } from "@/lib/model/shareLink"
import { useProjectStore } from "@/store/useProjectStore"

/**
 * Internal links that must not lose the visitor's design. Every in-app
 * navigation (studio ⇄ /why ⇄ /webmcp) is a full page load, so the current
 * design rides along as share-link parameters — the same vocabulary agents
 * and share links use. This keeps the round trip lossless even where
 * localStorage isn't available (private windows, some in-app browsers).
 */
export function useDesignHref(path: string): string {
  const form = useProjectStore((s) => s.form)
  const clay = useProjectStore((s) => s.clay)
  const paperSize = useProjectStore((s) => s.paperSize)
  const unit = useProjectStore((s) => s.unit)
  return `${path}?${buildShareParams(form, clay, paperSize, unit).toString()}`
}

/** Href for "back to the studio" links on the explainer pages. */
export function useStudioHref(): string {
  return useDesignHref("/")
}
