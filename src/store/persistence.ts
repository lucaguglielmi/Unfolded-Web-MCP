import {
  claySettingsSchema,
  formParamsSchema,
  normalizeLegacyFormPatch,
} from "@/lib/model/schemas"
import { PAPERS, type PaperSize } from "@/lib/export/svg"
import { isUnit } from "@/lib/units"
import { useProjectStore } from "./useProjectStore"

const STORAGE_KEY = "unfolded:project:v1"

/**
 * Restore the last session's design from localStorage — call at boot,
 * BEFORE applyShareLinkFromLocation so an explicit share link always wins
 * over what was left lying around. Anything invalid or corrupted is
 * ignored field-by-field (schemas re-validate everything).
 */
export function loadPersistedProject(): void {
  if (typeof window === "undefined") return
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const data: unknown = JSON.parse(raw)
    if (typeof data !== "object" || data === null) return
    const record = data as Record<string, unknown>
    const form = formParamsSchema.safeParse(
      typeof record.form === "object" && record.form !== null
        ? normalizeLegacyFormPatch(record.form as Record<string, unknown>)
        : record.form
    )
    const clay = claySettingsSchema.safeParse(record.clay)
    const paperSize =
      typeof record.paperSize === "string" && record.paperSize in PAPERS
        ? (record.paperSize as PaperSize)
        : undefined
    useProjectStore.setState({
      ...(form.success ? { form: form.data } : {}),
      ...(clay.success ? { clay: clay.data } : {}),
      ...(paperSize ? { paperSize } : {}),
      ...(isUnit(record.unit) ? { unit: record.unit } : {}),
    })
  } catch {
    // corrupted storage or blocked localStorage — start fresh
  }
}

/** Save the design (debounced) so a mid-demo refresh doesn't lose work. */
export function startProjectPersistence(): void {
  if (typeof window === "undefined") return
  let timer: number | undefined
  useProjectStore.subscribe(() => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      try {
        const { form, clay, paperSize, unit } = useProjectStore.getState()
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ form, clay, paperSize, unit }))
      } catch {
        // quota exceeded or private mode — persistence is best-effort
      }
    }, 400)
  })
}
