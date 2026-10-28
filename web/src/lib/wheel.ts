import type { EventSettings, Sector } from '@/api/types.gen'

/** The wheel's default spin, in seconds. */
export const DEFAULT_WHEEL_SECONDS = 4.5

/** How long a wheel of this kind turns in the event (games and movies share one setting). */
export function wheelSeconds(settings: EventSettings | undefined, kind: string): number {
  const s = kind === 'games' || kind === 'movies' ? settings?.gameWheelSeconds : settings?.itemWheelSeconds
  return s && s > 0 ? s : DEFAULT_WHEEL_SECONDS
}

/** The wheel's drawing in SVG units: the viewBox side and the radius of the sectors. */
export const WHEEL_SIZE = 320
export const WHEEL_R = WHEEL_SIZE / 2 - 6

const kindColors: Record<string, [string, string]> = {
  effect: ['#f59e0b', '#fbbf24'],
  bonus: ['#16a34a', '#22c55e'],
  drop: ['#dc2626', '#ef4444'],
  '': ['#78716c', '#a8a29e'],
}

/** A sector with its place on the wheel: degrees clockwise from the top. */
export type Slice = { start: number; end: number; sector: Sector; color: string }

export function slices(sectors: Sector[]): Slice[] {
  const total = sectors.reduce((sum, s) => sum + Math.max(s.weight, 0), 0) || 1
  let at = 0
  return sectors.map((sector, i) => {
    const span = (Math.max(sector.weight, 0) / total) * 360
    const pair = kindColors[sector.kind] ?? kindColors['']!
    const color = sector.kind ? pair[i % 2]! : i % 2 ? '#d6d3d1' : '#e7e5e4'
    const s = { start: at, end: at + span, sector, color }
    at += span
    return s
  })
}

/**
 * The index of the sector under the pointer (at the top) when the wheel is
 * turned clockwise by `rotation` degrees.
 */
export function sectorAt(parts: Slice[], rotation: number): number {
  const at = (((-rotation % 360) + 360) % 360)
  const i = parts.findIndex((p) => at >= p.start && at < p.end)
  return i === -1 ? parts.length - 1 : i
}

/** The rotation in degrees of a computed CSS transform (`matrix(...)`), or null when there is none. */
export function angleOf(transform: string): number | null {
  const m = transform.match(/^matrix(3d)?\(([^)]+)\)$/)
  if (!m) return null
  const [a, b] = m[2]!.split(',').map(Number)
  if (a === undefined || b === undefined || Number.isNaN(a) || Number.isNaN(b)) return null
  return (Math.atan2(b, a) * 180) / Math.PI
}
