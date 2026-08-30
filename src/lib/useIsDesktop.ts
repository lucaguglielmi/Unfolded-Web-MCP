import { useEffect, useState } from "react"

/** Tailwind's lg breakpoint — where the preview stops being a thumbnail. */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 64rem)").matches
  )
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 64rem)")
    const onChange = () => setIsDesktop(mq.matches)
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])
  return isDesktop
}
