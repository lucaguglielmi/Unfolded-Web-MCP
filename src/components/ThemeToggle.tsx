import { Moon, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"
import { feedback } from "@/lib/feedback"
import { setTheme, useTheme } from "@/lib/theme"

/**
 * Header light/dark switch, sitting beside the sound toggle. Shows the
 * theme you'd switch TO (moon in light mode, sun in dark), the way most
 * apps read.
 */
export function ThemeToggle() {
  const theme = useTheme()
  const label = theme === "dark" ? "Switch to light mode" : "Switch to dark mode"

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      onClick={() => {
        setTheme(theme === "dark" ? "light" : "dark")
        feedback("tap")
      }}
    >
      {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  )
}
