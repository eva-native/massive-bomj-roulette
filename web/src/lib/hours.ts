/** Upper limit for game hours; the server checks the same value. */
export const MAX_HOURS = 10000

/**
 * Keeps only what can be part of an hours number: digits and one decimal
 * separator (a comma becomes a dot). Use it on every keystroke.
 */
export function cleanHoursInput(raw: string): string {
  const s = raw.replace(',', '.').replace(/[^\d.]/g, '')
  const dot = s.indexOf('.')
  return dot < 0 ? s : s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '')
}

/** Parses cleaned input. Empty input is 0; anything invalid is null. */
export function parseHours(input: string): number | null {
  if (input === '') return 0
  const n = Number(input)
  return Number.isFinite(n) && n >= 0 && n <= MAX_HOURS ? n : null
}
