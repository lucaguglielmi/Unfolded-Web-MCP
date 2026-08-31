import { useSyncExternalStore } from "react"

/**
 * Light/dark theme, as a tiny module store. The choice persists in
 * localStorage; without one we follow the OS. Applying the theme toggles
 * the `.dark` class on <html> (which drives every CSS token and `dark:`
 * variant) — an inline script in index.html does the same before first
 * paint, so there is no white flash for dark-theme visitors.
 */

export type Theme = "light" | "dark"

const STORAGE_KEY = "unfolded-theme"
/* matches the dark boot-loader background in index.html */
const DARK_CHROME = "#05080f"

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === "light" || saved === "dark") return saved
  } catch {
    /* storage may be unavailable (private mode) — fall through to the OS */
  }
  return typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light"
}

let theme: Theme = initialTheme()
const listeners = new Set<() => void>()

function apply(t: Theme) {
  document.documentElement.classList.toggle("dark", t === "dark")
  // keep the browser chrome (mobile status bar) in step with the app
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", t === "dark" ? DARK_CHROME : "#ffffff")
}
apply(theme)

export function getTheme(): Theme {
  return theme
}

export function setTheme(next: Theme): void {
  if (next === theme) return
  theme = next
  apply(next)
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    /* not persisted — the session still switches */
  }
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, getTheme)
}
