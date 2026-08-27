import { AgentBadge } from "@/components/AgentBadge"
import { ParamsPanel } from "@/components/panels/ParamsPanel"
import { TemplatePanel } from "@/components/panels/TemplatePanel"
import { Viewport } from "@/components/viewport/Viewport"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useWebMCP } from "@/mcp/useWebMCP"

export default function App() {
  useWebMCP()

  return (
    <TooltipProvider>
      <div className="bg-background text-foreground flex h-screen flex-col">
        <header className="flex items-center justify-between border-b px-5 py-2.5">
          <div className="flex items-baseline gap-3">
            <h1 className="text-base font-semibold tracking-tight">Unfolded</h1>
            <p className="text-muted-foreground hidden text-xs sm:block">
              slab pottery templates — design in 3D, print flat, build in clay
            </p>
          </div>
          <AgentBadge />
        </header>
        <div className="flex min-h-0 flex-1">
          <aside className="w-72 shrink-0 overflow-y-auto border-r p-5 lg:w-80">
            <ParamsPanel />
          </aside>
          <main className="flex min-w-0 flex-1">
            <div className="min-w-0 flex-1 border-r">
              <Viewport />
            </div>
            <div className="min-w-0 flex-1">
              <TemplatePanel />
            </div>
          </main>
        </div>
      </div>
    </TooltipProvider>
  )
}
