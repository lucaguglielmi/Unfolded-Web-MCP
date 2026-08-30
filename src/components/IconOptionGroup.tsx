import { useRef } from "react"
import type { KeyboardEvent } from "react"
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
 *
 * Keyboard behavior follows the ARIA radiogroup pattern: one roving
 * tab-stop (the selected option), arrow keys move and select, Home/End
 * jump to the extremes.
 */
export function IconOptionGroup<T extends string>({
  value,
  onChange,
  options,
  orientation = "vertical",
  columns,
  className,
}: {
  value: T
  onChange: (value: T) => void
  options: IconOption<T>[]
  orientation?: "vertical" | "horizontal"
  /** grid columns; defaults to one column per option (single row) */
  columns?: number
  className?: string
}) {
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([])
  const selectedIndex = options.findIndex((o) => o.value === value)
  const tabbableIndex = selectedIndex >= 0 ? selectedIndex : 0

  const moveTo = (index: number) => {
    const next = (index + options.length) % options.length
    onChange(options[next].value)
    buttonRefs.current[next]?.focus()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault()
        moveTo(index + 1)
        break
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault()
        moveTo(index - 1)
        break
      case "Home":
        event.preventDefault()
        moveTo(0)
        break
      case "End":
        event.preventDefault()
        moveTo(options.length - 1)
        break
    }
  }

  return (
    <div
      role="radiogroup"
      className={cn("grid gap-2", className)}
      style={{ gridTemplateColumns: `repeat(${columns ?? options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option, index) => {
        const Icon = option.icon
        const selected = option.value === value
        return (
          <button
            key={option.value}
            ref={(node) => {
              buttonRefs.current[index] = node
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={index === tabbableIndex ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(e) => handleKeyDown(e, index)}
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
