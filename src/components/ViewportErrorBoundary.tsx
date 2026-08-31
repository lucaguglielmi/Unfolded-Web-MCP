import { Component, Fragment, type ReactNode } from "react"
import { LogoMark } from "@/components/LogoMark"
import { Button } from "@/components/ui/button"

/**
 * Keeps a 3D failure contained: a WebGL context loss, a driver quirk, or a
 * three.js exception downs only the preview — the params, the template
 * panel, and the PDF export (which never touches the canvas) keep working.
 *
 * A failure is NOT treated as permanent. The common real-world case is
 * mobile Safari reclaiming the GPU context while the tab sits in the
 * background — the browser is fine, the preview just needs a fresh canvas.
 * So the boundary retries by remounting its children (a bumped key tears
 * the old tree down and builds a new Canvas + WebGL context): automatically
 * when the tab next becomes visible, and on demand via a Reload button.
 * Only when the browser can't create a WebGL context at all does it settle
 * into the honest "not available in this browser" message.
 */

/** stop auto-retrying after this many consecutive failures — a browser
    that keeps crashing the scene shouldn't burn CPU in a remount loop
    (the manual button stays, and any successful mount resets the count) */
const MAX_AUTO_RETRIES = 3

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas")
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"))
  } catch {
    return false
  }
}

interface State {
  failed: boolean
  /** remount key: bumping it rebuilds the whole canvas subtree */
  generation: number
}

/** a remount that survives this long counts as a real recovery */
const RECOVERY_RESET_MS = 10_000

export class ViewportErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false, generation: 0 }
  private autoRetries = 0
  private recoveryTimer: number | undefined

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true }
  }

  componentDidCatch(error: unknown): void {
    console.error("3D preview crashed — the rest of the app keeps working:", error)
  }

  // arm/disarm the visibility listener as the boundary trips and recovers
  componentDidUpdate(_: unknown, prev: State): void {
    if (this.state.failed && !prev.failed) {
      window.clearTimeout(this.recoveryTimer)
      document.addEventListener("visibilitychange", this.onVisible)
    } else if (!this.state.failed && prev.failed) {
      document.removeEventListener("visibilitychange", this.onVisible)
      this.recoveryTimer = window.setTimeout(() => {
        this.autoRetries = 0
      }, RECOVERY_RESET_MS)
    }
  }

  componentWillUnmount(): void {
    document.removeEventListener("visibilitychange", this.onVisible)
    window.clearTimeout(this.recoveryTimer)
  }

  private onVisible = () => {
    // coming back to the tab is exactly when a reclaimed GPU context can be
    // recreated — the scenario that stranded the old permanent message
    if (document.visibilityState !== "visible") return
    if (this.autoRetries >= MAX_AUTO_RETRIES) return
    this.autoRetries += 1
    this.retry()
  }

  private retry = () => {
    this.setState((s) => ({ failed: false, generation: s.generation + 1 }))
  }

  render(): ReactNode {
    if (!this.state.failed) {
      return <Fragment key={this.state.generation}>{this.props.children}</Fragment>
    }

    // no WebGL at all — a retry can't help, say so plainly
    if (!webglAvailable()) {
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

    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-4">
        <LogoMark className="h-8 w-auto opacity-60" />
        <p className="text-muted-foreground max-w-64 text-center text-xs leading-relaxed">
          The 3D preview went to sleep while this tab was in the background.
          Your design, templates, and PDF export are untouched.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            this.autoRetries = 0
            this.retry()
          }}
        >
          Wake the preview
        </Button>
      </div>
    )
  }
}
