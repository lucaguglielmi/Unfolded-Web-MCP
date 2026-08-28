import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

export interface IconOption<T extends string> {
  value: T
  label: string
  icon: LucideIcon
}

/**
 * A choice between a small set of named options (a form field), rendered as
 * bordered icon cards rather than shadcn's Tabs — Tabs are for navigating
 * between views, this is for picking a value. Keeping the two visually
 * distinct matters most on mobile, where a Tabs-styled view switcher sits
 * directly under the page-level Tabs nav and would otherwise read as a
 * second, nested level of navigation.
 */
export function IconOptionGroup<T extends string>({
  value,
  onChange,
  options,
  orientation = "vertical",
  className,
}: {
  value: T
  onChange: (value: T) => void
  options: IconOption<T>[]
  orientation?: "vertical" | "horizontal"
  className?: string
}) {
  return (
    <div
      role="radiogroup"
      className={cn("grid gap-2", className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const Icon = option.icon
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex items-center justify-center rounded-lg border text-sm font-medium transition-colors active:scale-[0.98]",
              orientation === "vertical" ? "flex-col gap-1.5 py-3" : "gap-2 py-2.5",
              selected
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:border-foreground/30 hover:bg-accent hover:text-foreground"
            )}
          >
            <Icon className={orientation === "vertical" ? "size-5" : "size-4"} />
            <span>{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
