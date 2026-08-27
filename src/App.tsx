import { AgentBadge } from "@/components/AgentBadge"
import { ParamsPanel } from "@/components/panels/ParamsPanel"
import { TemplatePanel } from "@/components/panels/TemplatePanel"
import { Viewport } from "@/components/viewport/Viewport"
import { useWebMCP } from "@/mcp/useWebMCP"

export default function App() {
  useWebMCP()

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold leading-none">Unfolded</h1>
          <p className="text-muted-foreground mt-1 text-xs">
            Slab pottery templates — design in 3D, print flat, build in clay
          </p>
        </div>
        <AgentBadge />
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="w-80 shrink-0 overflow-y-auto border-r p-4">
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
  )
}
