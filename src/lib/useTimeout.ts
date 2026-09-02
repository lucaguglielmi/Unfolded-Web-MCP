import { useCallback, useEffect, useRef } from "react"

/**
 * A setTimeout tied to the component's lifetime: whatever is scheduled is
 * cleared on unmount (and by the next schedule), so a "Copied" flash can't
 * set state on a component that has since gone away.
 */
export function useTimeout(): (fn: () => void, ms: number) => void {
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return useCallback((fn: () => void, ms: number) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(fn, ms)
  }, [])
}
