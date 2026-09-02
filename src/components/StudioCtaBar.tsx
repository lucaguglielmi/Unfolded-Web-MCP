import { ArrowRight, Shapes } from "lucide-react"
import { useStudioHref } from "@/lib/useStudioHref"

/**
 * The explainer pages' fixed bottom bar: one big blue CTA back into the
 * 3D studio, always one tap from reading to making. Pages rendering it
 * give <main> enough bottom padding (pb-44) to clear the bar; the bar
 * itself respects the phone's safe area.
 */
export function StudioCtaBar() {
  const studioHref = useStudioHref()
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border/60 bg-background/85 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md">
      <a
        href={studioHref}
        className="group mx-auto flex w-full max-w-3xl items-center justify-center gap-2.5 rounded-full bg-blue-600 px-6 py-3.5 text-base font-semibold text-white shadow-lg shadow-blue-600/25 transition-all hover:scale-[1.015] hover:bg-blue-500 active:scale-[0.99]"
      >
        <Shapes className="size-5 transition-transform duration-300 group-hover:-rotate-12 group-hover:scale-110" />
        Open the 3D Studio
        <ArrowRight className="size-5 transition-transform duration-300 group-hover:translate-x-1" />
      </a>
    </div>
  )
}
