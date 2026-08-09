export type Locale = 'en' | 'ar'

/**
 * Bilingual display convention:
 * - Prefer explicit `message` + `messageAr` fields when both exist.
 * - Else split a single `"English / العربية"` string on ` / `.
 * - Locale picks which side to show; falls back to the other if empty.
 */
export function pickBilingual(
  message: string | null | undefined,
  messageAr: string | null | undefined,
  locale: Locale,
): string {
  const en = (message ?? '').trim()
  const ar = (messageAr ?? '').trim()

  if (en || ar) {
    if (locale === 'ar') return ar || en
    return en || ar
  }
  return ''
}

/** Parse backend bilingual detail strings shaped as `"English / العربية"`. */
export function splitSlashBilingual(combined: string | null | undefined): {
  message: string
  messageAr: string
} {
  const raw = (combined ?? '').trim()
  if (!raw) return { message: '', messageAr: '' }
  const idx = raw.indexOf(' / ')
  if (idx === -1) return { message: raw, messageAr: raw }
  return {
    message: raw.slice(0, idx).trim(),
    messageAr: raw.slice(idx + 3).trim(),
  }
}

export function displayBilingualText(
  input:
    | string
    | { message?: string | null; messageAr?: string | null; detail?: string | null }
    | null
    | undefined,
  locale: Locale,
): string {
  if (input == null) return ''
  if (typeof input === 'string') {
    const parts = splitSlashBilingual(input)
    return pickBilingual(parts.message, parts.messageAr, locale)
  }
  if (input.message != null || input.messageAr != null) {
    return pickBilingual(input.message, input.messageAr, locale)
  }
  if (input.detail) {
    const parts = splitSlashBilingual(input.detail)
    return pickBilingual(parts.message, parts.messageAr, locale)
  }
  return ''
}

export function tLabel(en: string, ar: string, locale: Locale): string {
  return pickBilingual(en, ar, locale)
}
