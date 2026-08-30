import { lazy, Suspense, useEffect, useState } from "react"
import { Box, Check, Link2, Maximize2, Redo2, Scissors, Undo2, X } from "lucide-react"
import { AgentBadge } from "@/components/AgentBadge"
import { ChromeFlagNudge } from "@/components/ChromeFlagNudge"
import { LogoMark } from "@/components/LogoMark"
import { ExportPdfDialog } from "@/components/ExportPdfDialog"
import { IconOptionGroup } from "@/components/IconOptionGroup"
import { ParamsPanel } from "@/components/panels/ParamsPanel"
import { TemplatePanel } from "@/components/panels/TemplatePanel"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { WebMCPPage } from "@/pages/WebMCPPage"
import { shareUrl } from "@/lib/model/shareLink"
import { useProjectStore } from "@/store/useProjectStore"
import { useWebMCP } from "@/mcp/useWebMCP"

type PreviewView = "3d" | "template"

/*
 * The 3D stack (three.js + react-three-fiber) is by far the heaviest part
 * of the bundle — lazy-loading it lets the app shell paint immediately,
 * with a small kiln-warming loader where the preview will appear.
 */
const Viewport = lazy(() =>
  import("@/components/viewport/Viewport").then((m) => ({ default: m.Viewport }))
)

function ViewportLoader() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3">
      <LogoMark className="gentle-pulse h-8 w-auto" />
      <p className="text-muted-foreground gentle-pulse text-xs">warming up the kiln…</p>
    </div>
  )
}

/** Tailwind's lg breakpoint — where the preview stops being a thumbnail. */
function useIsDesktop(): boolean {
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

/**
 * Undo/redo, floating at the bottom-left of the preview — the thumbnail
 * card on mobile, the 3D viewport when expanded or on desktop. Works on
 * changes from the person and the agent alike.
 */
function UndoRedoControls() {
  const canUndo = useProjectStore((s) => s.history.length > 0)
  const canRedo = useProjectStore((s) => s.future.length > 0)
  const undo = useProjectStore((s) => s.undo)
  const redo = useProjectStore((s) => s.redo)

  const buttonClass =
    "bg-background/90 text-foreground flex size-8 items-center justify-center rounded-md border shadow-sm transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40"

  return (
    <div className="absolute bottom-2.5 left-2.5 z-20 flex gap-1.5">
      <button
        type="button"
        aria-label="Undo last change"
        title="Undo last change"
        disabled={!canUndo}
        onClick={() => undo()}
        className={buttonClass}
      >
        <Undo2 className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label="Redo last undone change"
        title="Redo"
        disabled={!canRedo}
        onClick={() => redo()}
        className={buttonClass}
      >
        <Redo2 className="size-3.5" />
      </button>
    </div>
  )
}

/**
 * Share dialog: the design's deep link as a QR (scan with a phone to
 * continue in ChatGPT's browser there) plus one-tap copy. The address bar
 * already tracks the design live (see startShareLinkSync) — this is the
 * way to grab it, especially in in-app browsers that hide the URL bar.
 */
function ShareDialog() {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [qr, setQr] = useState<string | null>(null)

  const form = useProjectStore((s) => s.form)
  const clay = useProjectStore((s) => s.clay)
  const paperSize = useProjectStore((s) => s.paperSize)
  const url = shareUrl(form, clay, paperSize)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    import("qrcode")
      .then(({ toDataURL }) =>
        // error correction H tolerates the logomark sitting in the middle
        toDataURL(url, {
          margin: 1,
          width: 512,
          errorCorrectionLevel: "H",
          color: { dark: "#1c1917", light: "#ffffff" },
        })
      )
      .then((dataUrl) => {
        if (!cancelled) setQr(dataUrl)
      })
      .catch(() => {
        if (!cancelled) setQr(null)
      })
    return () => {
      cancelled = true
    }
  }, [open, url])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard can be unavailable (permissions, older webviews)
      window.prompt("Copy this link to share the design:", url)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Share this design" title="Share this design">
          <Link2 className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Share this design</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4">
          {qr && (
            <div className="rise-in relative">
              <img
                src={qr}
                alt="QR code of the design's share link"
                className="size-44 rounded-lg border p-2"
              />
              {/* the logomark lives in the middle — EC level H absorbs it */}
              <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md bg-white px-1.5 py-1">
                <LogoMark className="h-5 w-auto" />
              </span>
            </div>
          )}
          <p className="text-muted-foreground text-center text-xs leading-relaxed">
            Scan with your phone to open this exact design there — for example in
            ChatGPT's browser, where your agent can keep editing it. The link updates
            live as you work.
          </p>
          <code className="bg-muted text-muted-foreground w-full truncate rounded-md px-3 py-2 text-[11px]">
            {url}
          </code>
          <Button onClick={copy} className="w-full">
            {copied ? (
              <>
                <Check className="size-4" /> Copied
              </>
            ) : (
              "Copy link"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

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
  const isDesktop = useIsDesktop()

  // /webmcp: the explainer page the header's WebMCP pill links to. The
  // Worker serves index.html for every path (SPA fallback), so this one
  // check is all the routing the app needs. Tools register on this page
  // too (useWebMCP above), so it can show the live connection status.
  if (window.location.pathname.replace(/\/+$/, "") === "/webmcp") {
    return <WebMCPPage />
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
            <ShareDialog />
            <AgentBadge />
          </div>
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
              // lg:relative (not static) so UndoRedoControls anchors to the
              // preview cluster on desktop too
              "bg-background lg:relative lg:z-auto lg:order-2 lg:m-0 lg:flex lg:h-auto lg:min-h-0 lg:min-w-0 lg:flex-1 lg:flex-row lg:overflow-visible lg:rounded-none lg:border-0"
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
              {/* In the small thumbnail all callouts at once would clutter —
                  cycle them one at a time; the main preview shows them all. */}
              <Suspense fallback={<ViewportLoader />}>
                <Viewport
                  showHintOnMobile={previewExpanded}
                  measurementsMode={previewExpanded || isDesktop ? "static" : "cycle"}
                />
              </Suspense>
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

            <UndoRedoControls />

            {/* Thumbnail tap targets: the whole card opens the 3D preview;
                the chips open straight into either full-screen view */}
            {!previewExpanded && (
              <div className="absolute inset-0 z-10 lg:hidden">
                <button
                  type="button"
                  aria-label="Open full-screen 3D preview"
                  onClick={() => {
                    setPreviewView("3d")
                    setPreviewExpanded(true)
                  }}
                  className="absolute inset-0"
                />
                <div className="absolute right-2.5 bottom-2.5 flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setPreviewView("3d")
                      setPreviewExpanded(true)
                    }}
                    className="bg-background/90 text-foreground flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium shadow-sm"
                  >
                    <Maximize2 className="size-3.5" />
                    Preview
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPreviewView("template")
                      setPreviewExpanded(true)
                    }}
                    className="bg-background/90 text-foreground flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium shadow-sm"
                  >
                    <Scissors className="size-3.5" />
                    Templates
                  </button>
                </div>
              </div>
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

        {/* Chrome-only tip: WebMCP is one documented flag away */}
        <ChromeFlagNudge />
      </div>
    </TooltipProvider>
  )
}
