// Apply the saved (or OS) theme before first paint — no white flash for
// dark-mode visitors; src/lib/theme.ts owns it from then on. Lives in its
// own file (not inline in index.html) so the Content-Security-Policy can
// stay `script-src 'self'` with no inline-script hashes to maintain.
try {
  var t = localStorage.getItem("unfolded-theme")
  if (t === "dark" || (!t && matchMedia("(prefers-color-scheme: dark)").matches)) {
    document.documentElement.classList.add("dark")
  }
} catch (e) {}
