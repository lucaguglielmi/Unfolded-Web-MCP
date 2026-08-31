import { useState } from "react"
import { HelpCircle, Menu, Share2, X } from "lucide-react"
import { AgentBadge } from "@/components/AgentBadge"
import { ShareDialog } from "@/components/ShareDialog"
import { Button } from "@/components/ui/button"

/**
 * Phone header menu: one button gathering what the narrow header can't fit
 * side by side — the WebMCP status pill, the Why Unfolded link, and Share
 * this design. (The audio toggle stays directly in the header.)
 */
export function MobileMenu() {
  const [open, setOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)

  const rowClass =
    "flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <X className="size-4" /> : <Menu className="size-4" />}
      </Button>

      {open && (
        <>
          {/* click-away backdrop */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="bg-background absolute top-full right-0 z-50 mt-2 w-64 rounded-xl border p-2 shadow-lg">
            {/* the WebMCP pill is a link to /webmcp — tapping it navigates */}
            <div className="px-1.5 py-2" onClick={() => setOpen(false)}>
              <AgentBadge />
            </div>
            <a href="/why" className={rowClass} onClick={() => setOpen(false)}>
              <HelpCircle className="text-muted-foreground size-4" />
              Why Unfolded
            </a>
            <button
              type="button"
              className={rowClass}
              onClick={() => {
                setOpen(false)
                setShareOpen(true)
              }}
            >
              <Share2 className="text-muted-foreground size-4" />
              Share this design
            </button>
          </div>
        </>
      )}

      {/* controlled instance — the menu row above opens it */}
      <ShareDialog open={shareOpen} onOpenChange={setShareOpen} />
    </div>
  )
}
