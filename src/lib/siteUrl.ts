/**
 * The single authoritative deployed origin.
 *
 * Sourced from VITE_SITE_URL — vite.config.ts fills it from .env.example
 * when the environment doesn't set it, and index.html's OG tags read the
 * same variable at build time. The literal below is the one fallback for
 * contexts that bypass Vite's env loading (unit tests); nothing else in
 * src/ may spell the origin out.
 */
export const SITE_URL: string = (
  (import.meta.env?.VITE_SITE_URL as string | undefined) ?? "https://tryunfolded.com"
).replace(/\/+$/, "")
