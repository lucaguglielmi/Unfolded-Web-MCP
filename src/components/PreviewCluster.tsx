import { lazy, Suspense } from "react"
import { Box, Maximize2, Scissors, X } from "lucide-react"
import { IconOptionGroup } from "@/components/IconOptionGroup"
import { LogoMark } from "@/components/LogoMark"
import { TemplatePanel } from "@/components/panels/TemplatePanel"
import { UndoRedoControls } from "@/components/UndoRedoControls"
import { UnitToggle } from "@/components/UnitToggle"
import { ViewportErrorBoundary } from "@/components/ViewportErrorBoundary"
import { Button } from "@/components/ui/button"
import { useIsDesktop } from "@/lib/useIsDesktop"
import { cn } from "@/lib/utils"
import { useProjectStore } from "@/store/useProjectStore"

/*
 * The 3D stack (three.js + react-three-fiber) is by far the heaviest part
 * of the bundle — lazy-loading it lets the app shell paint immediately,
 * with a small kiln-warming loader where the preview will appear.
 */
const Viewport = lazy(() =>
  import("@/components/viewport/Viewport").then((m) => ({ default: m.Viewport }))
)

export type PreviewView = "3d" | "template"

export interface PreviewClusterProps {
  /** mobile full-screen overlay open? */
  expanded: boolean
  /** which panel the mobile overlay shows */
  view: PreviewView
  /** mobile card collapsed to the small scroll-chip? */
  collapsed: boolean
  onExpand: (view: PreviewView) => void
  onClose: () => void
}

/*
 * The cluster morphs between three shapes purely via classes — the load-
 * bearing constraint is that <Viewport> (the single WebGL canvas) mounts
 * exactly once and is NEVER remounted across these transitions:
 *
 *  - mobile card:     a rounded thumbnail above the settings (tall at rest,
 *                     collapsed to a small left-side chip while scrolling)
 *  - mobile overlay:  fixed full-screen with a 3D/template view picker
 *  - desktop split:   3D and template side by side, no card chrome
 */
const CLUSTER_DESKTOP =
  "bg-background lg:relative lg:z-auto lg:order-2 lg:m-0 lg:flex lg:h-auto lg:min-h-0 lg:min-w-0 lg:flex-1 lg:flex-row lg:overflow-visible lg:rounded-none lg:border-0"
const CLUSTER_OVERLAY = "fixed inset-0 z-50 flex flex-col"
const CLUSTER_CARD =
  "relative order-1 mx-4 mt-3 flex shrink-0 overflow-hidden rounded-xl border transition-[height] duration-300 ease-out"

const PREVIEW_VIEW_OPTIONS = [
  { value: "3d" as const, label: "3D preview", icon: Box },
  { value: "template" as const, label: "Template", icon: Scissors },
]

function ViewportLoader() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3">
      <LogoMark className="gentle-pulse h-8 w-auto" />
      <p className="text-muted-foreground gentle-pulse text-xs">warming up the kiln…</p>
    </div>
  )
}

export function PreviewCluster({ expanded, view, collapsed, onExpand, onClose }: PreviewClusterProps) {
  const isDesktop = useIsDesktop()
  const formName = useProjectStore((s) => s.form.name)

  return (
    <div
      className={cn(
        expanded ? CLUSTER_OVERLAY : cn(CLUSTER_CARD, collapsed ? "h-20" : "h-52"),
        // lg:relative (not static) so UndoRedoControls anchors to the
        // preview cluster on desktop too
        CLUSTER_DESKTOP
      )}
      style={expanded ? { paddingTop: "env(safe-area-inset-top)" } : undefined}
    >
      {/* Full-screen header: view picker + close (mobile only) */}
      {expanded && (
        <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2 lg:hidden">
          <IconOptionGroup
            value={view}
            onChange={onExpand}
            options={PREVIEW_VIEW_OPTIONS}
            orientation="horizontal"
            className="max-w-sm flex-1"
          />
          <Button variant="ghost" size="icon" aria-label="Close preview" onClick={onClose}>
            <X className="size-5" />
          </Button>
        </div>
      )}

      <div
        className={cn(
          "relative min-h-0",
          // the card's width morph animates: 100% <-> 6rem interpolate via
          // calc(), and shrink-0 keeps flex from fighting the transition
          // (the collapsed name label is flex-1 and yields per frame)
          expanded
            ? view === "3d"
              ? "flex-1"
              : "hidden"
            : cn(
                "h-full shrink-0 transition-[width] duration-300 ease-out",
                collapsed ? "w-24 border-r" : "w-full"
              ),
          "lg:block lg:h-auto lg:w-auto lg:flex-1 lg:border-r"
        )}
      >
        {/* In the small thumbnail all callouts at once would clutter —
            cycle them one at a time; the main preview shows them all;
            the collapsed scroll-chip is too small for any. */}
        <ViewportErrorBoundary>
          <Suspense fallback={<ViewportLoader />}>
            <Viewport
              showHintOnMobile={expanded}
              measurementsMode={expanded || isDesktop ? "static" : collapsed ? "hidden" : "cycle"}
            />
          </Suspense>
        </ViewportErrorBoundary>
        {/* units toggle floats in the main preview (not the thumbnail,
            where the tap overlay owns the corners) — the dimension
            callouts it switches live right here */}
        <div className={cn("absolute right-2.5 bottom-2.5 z-20", expanded ? "block" : "hidden lg:block")}>
          <UnitToggle className="bg-background/90 shadow-sm" />
        </div>
      </div>

      {/* Collapsed thumbnail: the piece's name rides beside the small 3D chip */}
      {!expanded && collapsed && (
        <div className="flex min-w-0 flex-1 flex-col justify-center px-3.5 lg:hidden">
          <p className="truncate text-sm font-medium">{formName}</p>
          <p className="text-muted-foreground text-xs">Tap to open the 3D preview</p>
        </div>
      )}

      <div
        className={cn(
          "min-h-0",
          expanded ? (view === "template" ? "flex-1" : "hidden") : "hidden",
          "lg:block lg:flex-1"
        )}
      >
        <TemplatePanel />
      </div>

      <UndoRedoControls className={cn(!expanded && collapsed && "max-lg:hidden")} />

      {/* Thumbnail tap targets: the whole card opens the 3D preview;
          the chips open straight into either full-screen view */}
      {!expanded && (
        <div className="absolute inset-0 z-10 lg:hidden">
          <button
            type="button"
            aria-label="Open full-screen 3D preview"
            onClick={() => onExpand("3d")}
            className="absolute inset-0"
          />
          <div className={cn("absolute right-2.5 bottom-2.5 flex gap-1.5", collapsed && "hidden")}>
            <button
              type="button"
              onClick={() => onExpand("3d")}
              className="bg-background/90 text-foreground flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium shadow-sm"
            >
              <Maximize2 className="size-3.5" />
              Preview
            </button>
            <button
              type="button"
              onClick={() => onExpand("template")}
              className="bg-background/90 text-foreground flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium shadow-sm"
            >
              <Scissors className="size-3.5" />
              Templates
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
