import { lazy, Suspense, useState, type UIEvent } from "react"
import { AgentBadge } from "@/components/AgentBadge"
import { ChromeFlagNudge } from "@/components/ChromeFlagNudge"
import { LogoMark } from "@/components/LogoMark"
import { ExportPdfDialog } from "@/components/ExportPdfDialog"
import { FeedbackToggle } from "@/components/FeedbackToggle"
import { ParamsPanel } from "@/components/panels/ParamsPanel"
import { PreviewCluster, type PreviewView } from "@/components/PreviewCluster"
import { ShareDialog } from "@/components/ShareDialog"
import { Button } from "@/components/ui/button"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useIsDesktop } from "@/lib/useIsDesktop"
import { useWebMCP } from "@/mcp/useWebMCP"

/* Most visitors never open the explainer — keep it out of the shell chunk. */
const WebMCPPage = lazy(() =>
  import("@/pages/WebMCPPage").then((m) => ({ default: m.WebMCPPage }))
)

export default function App() {
  useWebMCP()

  // Mobile: settings are the main page; the preview lives in a thumbnail
  // card up top and expands to a full-screen overlay on tap. Scrolling the
  // settings collapses the card into a small 3D chip on the left (with the
  // piece's name beside it) so the controls get the room; scrolling back
  // to the top restores it.
  const [previewExpanded, setPreviewExpanded] = useState(false)
  const [previewView, setPreviewView] = useState<PreviewView>("3d")
  const [previewCollapsed, setPreviewCollapsed] = useState(false)
  const isDesktop = useIsDesktop()

  const handleSettingsScroll = (event: UIEvent<HTMLDivElement>) => {
    if (isDesktop) return
    const top = event.currentTarget.scrollTop
    // hysteresis so the card doesn't flicker around the threshold
    setPreviewCollapsed((collapsed) => (collapsed ? top > 8 : top > 48))
  }

  // /webmcp: the explainer page the header's WebMCP pill links to. The
  // Worker serves index.html for every path (SPA fallback), so this one
  // check is all the routing the app needs. Tools register on this page
  // too (useWebMCP above), so it can show the live connection status.
  if (window.location.pathname.replace(/\/+$/, "") === "/webmcp") {
    return (
      <Suspense fallback={<div className="min-h-dvh bg-white" />}>
        <WebMCPPage />
      </Suspense>
    )
  }

  return (
    <TooltipProvider>
      <div className="bg-background text-foreground app-fade-in flex h-dvh flex-col overflow-hidden">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2.5 sm:px-5">
          <div className="flex min-w-0 items-baseline gap-2.5">
            <LogoMark animated className="h-5 w-auto shrink-0 self-center" />
            <h1 className="text-base font-semibold tracking-tight">unfolded</h1>
            <p className="text-muted-foreground hidden truncate text-xs sm:block">
              slab pottery templates — design in 3D, print flat, build in clay
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <FeedbackToggle />
            <ShareDialog />
            <AgentBadge />
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <PreviewCluster
            expanded={previewExpanded}
            view={previewView}
            collapsed={previewCollapsed}
            onExpand={(view) => {
              setPreviewView(view)
              setPreviewExpanded(true)
            }}
            onClose={() => setPreviewExpanded(false)}
          />

          {/* Settings: the main page on mobile, fixed sidebar on desktop */}
          <div
            onScroll={handleSettingsScroll}
            className="order-2 min-h-0 w-full flex-1 overflow-y-auto p-4 sm:p-5 lg:order-1 lg:w-72 lg:flex-none lg:border-r xl:w-80"
          >
            <ParamsPanel />
          </div>
        </div>

        {/* Mobile-only: large sticky export CTA */}
        <div
          className="shrink-0 border-t px-4 py-3 shadow-[0_-6px_16px_-8px_rgba(0,0,0,0.12)] lg:hidden"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          <ExportPdfDialog
            trigger={
              <Button size="lg" className="h-14 w-full text-base font-semibold">
                Export PDF
              </Button>
            }
          />
        </div>

        {/* Chrome-only tip: WebMCP is one documented flag away */}
        <ChromeFlagNudge />
      </div>
    </TooltipProvider>
  )
}
