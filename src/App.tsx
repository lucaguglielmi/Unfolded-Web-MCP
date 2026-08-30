import { useState } from "react"
import { Amphora, Box, Maximize2, Scissors, X } from "lucide-react"
import { AgentBadge } from "@/components/AgentBadge"
import { ExportPdfDialog } from "@/components/ExportPdfDialog"
import { IconOptionGroup } from "@/components/IconOptionGroup"
import { ParamsPanel } from "@/components/panels/ParamsPanel"
import { TemplatePanel } from "@/components/panels/TemplatePanel"
import { Viewport } from "@/components/viewport/Viewport"
import { Button } from "@/components/ui/button"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useWebMCP } from "@/mcp/useWebMCP"

type PreviewView = "3d" | "template"

const PREVIEW_VIEW_OPTIONS = [
  { value: "3d" as const, label: "3D preview", icon: Box },
  { value: "template" as const, label: "Template", icon: Scissors },
]

export default function App() {
  useWebMCP()

  // Mobile: settings are the main page; the preview lives in a small
  // thumbnail card up top and expands to a full-screen overlay on tap.
  const [previewExpanded, setPreviewExpanded] = useState(false)
  const [previewView, setPreviewView] = useState<PreviewView>("3d")

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

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          {/*
            Preview cluster (3D + template). One instance of each panel — the
            single WebGL canvas included — morphs between three shapes purely
            via classes: mobile thumbnail card, mobile full-screen overlay,
            desktop side-by-side split. Never duplicated, never remounted.
          */}
          <div
            className={cn(
              previewExpanded
                ? "fixed inset-0 z-50 flex flex-col"
                : "relative order-1 mx-4 mt-3 h-44 shrink-0 overflow-hidden rounded-xl border",
              "bg-background lg:static lg:z-auto lg:order-2 lg:m-0 lg:flex lg:h-auto lg:min-h-0 lg:min-w-0 lg:flex-1 lg:flex-row lg:overflow-visible lg:rounded-none lg:border-0"
            )}
            style={previewExpanded ? { paddingTop: "env(safe-area-inset-top)" } : undefined}
          >
            {/* Full-screen header: view picker + close (mobile only) */}
            {previewExpanded && (
              <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2 lg:hidden">
                <IconOptionGroup
                  value={previewView}
                  onChange={setPreviewView}
                  options={PREVIEW_VIEW_OPTIONS}
                  orientation="horizontal"
                  className="max-w-sm flex-1"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Close preview"
                  onClick={() => setPreviewExpanded(false)}
                >
                  <X className="size-5" />
                </Button>
              </div>
            )}

            <div
              className={cn(
                "min-h-0",
                previewExpanded ? (previewView === "3d" ? "flex-1" : "hidden") : "h-full",
                "lg:block lg:h-auto lg:flex-1 lg:border-r"
              )}
            >
              <Viewport showHintOnMobile={previewExpanded} />
            </div>
            <div
              className={cn(
                "min-h-0",
                previewExpanded ? (previewView === "template" ? "flex-1" : "hidden") : "hidden",
                "lg:block lg:flex-1"
              )}
            >
              <TemplatePanel />
            </div>

            {/* Thumbnail tap target: the whole card opens the full preview */}
            {!previewExpanded && (
              <button
                type="button"
                aria-label="Open full-screen preview"
                onClick={() => setPreviewExpanded(true)}
                className="absolute inset-0 z-10 flex items-end justify-end p-2.5 lg:hidden"
              >
                <span className="bg-background/90 text-foreground flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium shadow-sm">
                  <Maximize2 className="size-3.5" />
                  Preview
                </span>
              </button>
            )}
          </div>

          {/* Settings: the main page on mobile, fixed sidebar on desktop */}
          <div className="order-2 min-h-0 w-full flex-1 overflow-y-auto p-4 sm:p-5 lg:order-1 lg:w-72 lg:flex-none lg:border-r xl:w-80">
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
      </div>
    </TooltipProvider>
  )
}
