import { useState } from "react"
import { Amphora, Box, Loader2, Scissors } from "lucide-react"
import { AgentBadge } from "@/components/AgentBadge"
import { IconOptionGroup } from "@/components/IconOptionGroup"
import { ParamsPanel } from "@/components/panels/ParamsPanel"
import { TemplatePanel } from "@/components/panels/TemplatePanel"
import { Viewport } from "@/components/viewport/Viewport"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { countPages, layoutPieces } from "@/lib/export/svg"
import { selectPieces, useProjectStore } from "@/store/useProjectStore"
import { useWebMCP } from "@/mcp/useWebMCP"

type MobileTab = "settings" | "preview"
type PreviewView = "3d" | "template"

const PREVIEW_VIEW_OPTIONS = [
  { value: "3d" as const, label: "3D preview", icon: Box },
  { value: "template" as const, label: "Template", icon: Scissors },
]

export default function App() {
  useWebMCP()

  const [mobileTab, setMobileTab] = useState<MobileTab>("settings")
  const [previewView, setPreviewView] = useState<PreviewView>("3d")

  const form = useProjectStore((s) => s.form)
  const clay = useProjectStore((s) => s.clay)
  const paperSize = useProjectStore((s) => s.paperSize)
  const isExporting = useProjectStore((s) => s.isExporting)
  const exportError = useProjectStore((s) => s.exportError)
  const exportPdf = useProjectStore((s) => s.exportPdf)

  const pages = countPages(layoutPieces(selectPieces(form, clay)), paperSize)

  return (
    <TooltipProvider>
      <div className="bg-background text-foreground flex h-dvh flex-col overflow-hidden">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2.5 sm:px-5">
          <div className="flex min-w-0 items-baseline gap-2.5">
            <Amphora className="text-foreground size-5 shrink-0" strokeWidth={1.75} />
            <h1 className="text-base font-semibold tracking-tight">Unfolded</h1>
            <p className="text-muted-foreground hidden truncate text-xs sm:block">
              slab pottery templates — design in 3D, print flat, build in clay
            </p>
          </div>
          <AgentBadge />
        </header>

        {/* Mobile-only: primary Settings / Preview navigation, just below the header */}
        <div className="border-b px-4 py-2 lg:hidden">
          <Tabs value={mobileTab} onValueChange={(v) => setMobileTab(v as MobileTab)}>
            <TabsList className="w-full">
              <TabsTrigger value="settings" className="flex-1">
                Settings
              </TabsTrigger>
              <TabsTrigger value="preview" className="flex-1">
                Preview
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Settings: fixed sidebar on desktop, full-width tab pane on mobile */}
          <div
            className={cn(
              "min-h-0 w-full overflow-y-auto p-4 sm:p-5 lg:w-72 lg:border-r xl:w-80",
              mobileTab === "settings" ? "block" : "hidden",
              "lg:block"
            )}
          >
            <ParamsPanel />
          </div>

          {/* Preview cluster: 3D + template, side by side on desktop, switchable on mobile */}
          <div
            className={cn(
              "min-h-0 flex-1 flex-col lg:flex-row",
              mobileTab === "preview" ? "flex" : "hidden",
              "lg:flex"
            )}
          >
            {/* Mobile-only: 3D / Template is a view setting, not navigation — an
                icon option group reads as a value picker rather than a second,
                nested layer of tabs under the Settings/Preview nav above. */}
            <div className="border-b px-4 py-2 lg:hidden">
              <IconOptionGroup
                value={previewView}
                onChange={setPreviewView}
                options={PREVIEW_VIEW_OPTIONS}
                orientation="horizontal"
              />
            </div>

            <div
              className={cn(
                "min-h-0 flex-1 lg:border-r",
                previewView === "3d" ? "block" : "hidden",
                "lg:block"
              )}
            >
              <Viewport />
            </div>
            <div
              className={cn(
                "min-h-0 flex-1",
                previewView === "template" ? "block" : "hidden",
                "lg:block"
              )}
            >
              <TemplatePanel />
            </div>
          </div>
        </div>

        {/* Mobile-only: large sticky export CTA, reachable from any tab */}
        <div
          className="shrink-0 border-t px-4 py-3 shadow-[0_-6px_16px_-8px_rgba(0,0,0,0.12)] lg:hidden"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          {exportError && <p className="mb-2 text-xs text-red-600">Export failed: {exportError}</p>}
          <Button
            size="lg"
            className="h-14 w-full text-base font-semibold"
            onClick={() => exportPdf()}
            disabled={isExporting}
          >
            {isExporting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Exporting…
              </>
            ) : (
              `Export PDF · ${pages.totalPages} page${pages.totalPages > 1 ? "s" : ""}`
            )}
          </Button>
        </div>
      </div>
    </TooltipProvider>
  )
}
