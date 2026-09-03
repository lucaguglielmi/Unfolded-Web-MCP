import { LogoMark } from "@/components/LogoMark"
import { ThemeToggle } from "@/components/ThemeToggle"
import { useDesignHref, useStudioHref } from "@/lib/useStudioHref"
import { cn } from "@/lib/utils"

/**
 * Shared top bar of the /why and /webmcp explainer pages: the logomark, a
 * text nav that switches between the studio and the two pages (every link
 * carries the current design's parameters, so nothing is lost crossing
 * over), and the theme toggle. The active item is marked by a short bar
 * underneath it, deliberately not the filled pill ReadingDepthToolbar
 * uses, so the two rows of controls read as different things.
 */
export function ExplainerHeader({ current }: { current: "why" | "webmcp" }) {
  const studioHref = useStudioHref()
  const whyHref = useDesignHref("/why")
  const webmcpHref = useDesignHref("/webmcp")

  const items = [
    { key: "studio", label: "3D Studio", href: studioHref },
    { key: "why", label: "Why Unfolded", href: whyHref },
    { key: "webmcp", label: "WebMCP", href: webmcpHref },
  ] as const

  return (
    <header className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-x-4 gap-y-2.5 px-6 py-5">
      <a href={studioHref} className="flex items-center gap-2.5">
        <LogoMark animated className="h-5 w-auto" />
        <span className="text-base font-semibold tracking-tight">unfolded</span>
      </a>
      <div className="flex items-center gap-1.5">
        <nav aria-label="Site" className="flex items-center gap-0.5">
          {items.map((item) => (
            <a
              key={item.key}
              href={item.href}
              aria-current={item.key === current ? "page" : undefined}
              className={cn(
                "relative px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors sm:px-3.5",
                // The underline bar: inset to the label's width, sitting just
                // below the text, with the same rounded ends as the logomark.
                "after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:transition-colors sm:after:inset-x-3.5",
                item.key === current
                  ? "text-foreground after:bg-foreground"
                  : "text-muted-foreground after:bg-transparent hover:text-foreground"
              )}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <ThemeToggle />
      </div>
    </header>
  )
}
