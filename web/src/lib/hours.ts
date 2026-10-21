/** Upper limit for game hours; the server checks the same value. */
export const MAX_HOURS = 10000

/** A duration as typed: hours, minutes and seconds, digits only. */
export type HMS = { h: string; m: string; s: string }

export const emptyHMS: HMS = { h: '', m: '', s: '' }

/** Keeps only digits; use it on every keystroke. */
export function digits(raw: string): string {
  return raw.replace(/\D/g, '')
}

/** Hours from typed parts. Empty parts are 0; anything out of range is null. */
export function hmsToHours({ h, m, s }: HMS): number | null {
  const num = (v: string) => (v === '' ? 0 : Number(v))
  const [hh, mm, ss] = [num(h), num(m), num(s)]
  if ([hh, mm, ss].some((n) => !Number.isInteger(n) || n < 0) || mm > 59 || ss > 59) return null
  const hours = hh + mm / 60 + ss / 3600
  return hours <= MAX_HOURS ? hours : null
}

function split(totalSeconds: number) {
  const t = Math.max(0, Math.round(totalSeconds))
  return { h: Math.floor(t / 3600), m: Math.floor(t / 60) % 60, s: t % 60 }
}

/** Typed parts for stored hours (rounded to a second); zero parts stay empty. */
export function hoursToHMS(hours: number): HMS {
  const { h, m, s } = split(hours * 3600)
  const part = (n: number) => (n ? String(n) : '')
  return { h: part(h), m: part(m), s: part(s) }
}

/** «25 ч 30 мин 12 с», leaving out zero parts. */
export function formatHours(hours: number): string {
  const { h, m, s } = split(hours * 3600)
  const parts = [h && `${h} ч`, m && `${m} мин`, s && `${s} с`].filter(Boolean)
  return parts.length ? parts.join(' ') : '0 с'
}

/** A running clock: «1:05:09». */
export function formatClock(ms: number): string {
  const { h, m, s } = split(ms / 1000)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
