import { Component, type ReactNode } from "react"
import { LogoMark } from "@/components/LogoMark"

/**
 * Keeps a 3D failure contained: a WebGL context loss, a driver quirk, or a
 * three.js exception downs only the preview — the params, the template
 * panel, and the PDF export (which never touches the canvas) keep working.
 */
export class ViewportErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: unknown): void {
    console.error("3D preview crashed — the rest of the app keeps working:", error)
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-4">
        <LogoMark className="h-8 w-auto opacity-60" />
        <p className="text-muted-foreground max-w-56 text-center text-xs leading-relaxed">
          The 3D preview isn't available in this browser — your design, templates,
          and PDF export all still work.
        </p>
      </div>
    )
  }
}
