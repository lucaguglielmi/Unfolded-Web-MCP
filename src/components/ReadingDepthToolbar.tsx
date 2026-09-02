import { cn } from "@/lib/utils"

/**
 * The explainer pages' reading-depth switcher: a digest for the hurried,
 * the full story by default, and an agent-addressed deep dive for readers
 * who aren't human. Shared by /why and /webmcp.
 */

export type ReadingDepth = "1min" | "5min" | "agent"

const DEPTHS: { value: ReadingDepth; label: string }[] = [
  { value: "1min", label: "1 minute" },
  { value: "5min", label: "5 minutes" },
  { value: "agent", label: "I am not human" },
]

export function ReadingDepthToolbar({
  depth,
  onChange,
}: {
  depth: ReadingDepth
  onChange: (depth: ReadingDepth) => void
}) {
  return (
    // sticky: the depth choice stays reachable however deep the read goes.
    // -mx-6/px-6 mirror the pages' column padding so the blur band runs
    // edge-to-edge of the column on phones.
    <div className="sticky top-0 z-30 -mx-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border/60 bg-background/85 px-6 py-4 backdrop-blur-md">
      <p className="text-muted-foreground text-sm">How much time do you have to read this?</p>
      <div
        role="radiogroup"
        aria-label="Reading depth"
        className="flex rounded-full border border-border p-0.5"
      >
        {DEPTHS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={depth === value}
            onClick={() => onChange(value)}
            className={cn(
              "rounded-full px-3.5 py-1 text-xs font-medium transition-colors",
              depth === value
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
