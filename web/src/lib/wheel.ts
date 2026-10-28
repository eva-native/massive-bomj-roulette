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

/** Item kinds keep their colours: they mean something (effect, bonus, drop debuff). */
const kindColors: Record<string, [string, string]> = {
  effect: ['#f59e0b', '#fbbf24'],
  bonus: ['#16a34a', '#22c55e'],
  drop: ['#dc2626', '#ef4444'],
}

/**
 * Games and movies: the colours mean nothing and only tell neighbours apart,
 * so the wheel's turn is visible. Mid tones, not glaring on a dark card.
 */
export const plainColors = ['#7aa2c8', '#d4a05a', '#9f8bd0', '#6fb59a', '#d18a9c', '#a8b25c', '#5fb0c4', '#c99b7a']

function plainColor(i: number, n: number) {
  // The last sector touches the first: do not let them share a colour.
  if (n > 1 && i === n - 1 && i % plainColors.length === 0) return plainColors[3]!
  return plainColors[i % plainColors.length]!
}

/** A sector with its place on the wheel: degrees clockwise from the top. */
export type Slice = { start: number; end: number; sector: Sector; color: string }

export function slices(sectors: Sector[]): Slice[] {
  const total = sectors.reduce((sum, s) => sum + Math.max(s.weight, 0), 0) || 1
  let at = 0
  return sectors.map((sector, i) => {
    const span = (Math.max(sector.weight, 0) / total) * 360
    const pair = kindColors[sector.kind]
    const color = pair ? pair[i % 2]! : plainColor(i, sectors.length)
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

/** Labels and icons keep about this size on screen, however big the wheel is drawn. */
const LABEL_PX = 12
const ICON_PX = 16
/** Where text labels end and icons sit, and how close to the hub a label may start, in SVG units. */
export const LABEL_OUTER = 0.9 * WHEEL_R
export const ICON_RADIUS = 0.8 * WHEEL_R
const HUB_CLEARANCE = 18

/** What the sectors of a wheel show: text along the radius, item icons near the rim, or nothing. */
export type LabelMode = { kind: 'text'; font: number; maxChars: number } | { kind: 'icons'; size: number } | { kind: 'none' }

/**
 * What fits into the sectors of a wheel drawn `px` wide. A label runs from
 * the rim towards the hub and must stop where the narrowest sector becomes
 * thinner than a line of text; sizes are in SVG units, chosen so that they
 * come out at about LABEL_PX and ICON_PX on screen. Text wins when at least
 * 10 characters fit; otherwise item icons if every sector has one and they
 * fit; otherwise shorter text; otherwise nothing.
 */
export function labelMode(parts: Slice[], px: number): LabelMode {
  const spans = parts.map((p) => p.end - p.start).filter((s) => s > 0)
  if (spans.length === 0 || px <= 0) return { kind: 'none' }
  const scale = px / WHEEL_SIZE
  const narrowest = (Math.min(...spans) * Math.PI) / 180 // radians
  const font = Math.min(Math.max(LABEL_PX / scale, 6), 13)
  const start = Math.min(Math.max((1.15 * font) / narrowest, HUB_CLEARANCE), LABEL_OUTER)
  const maxChars = Math.floor((LABEL_OUTER - start) / (0.56 * font)) // 0.56: an average glyph's width per unit of font size
  const icon = ICON_PX / scale
  const iconsFit = parts.every((p) => p.sector.defId) && ICON_RADIUS * narrowest >= 1.2 * icon
  if (maxChars >= 10) return { kind: 'text', font, maxChars }
  if (iconsFit) return { kind: 'icons', size: icon }
  if (maxChars >= 6) return { kind: 'text', font, maxChars }
  return { kind: 'none' }
}

/** A label cut to `maxChars` characters, with an ellipsis when cut. */
export function fitLabel(label: string, maxChars: number): string {
  const chars = Array.from(label)
  return chars.length <= maxChars ? label : chars.slice(0, Math.max(maxChars - 1, 1)).join('') + '…'
}

/** The rotation in degrees of a computed CSS transform (`matrix(...)`), or null when there is none. */
export function angleOf(transform: string): number | null {
  const m = transform.match(/^matrix(3d)?\(([^)]+)\)$/)
  if (!m) return null
  const [a, b] = m[2]!.split(',').map(Number)
  if (a === undefined || b === undefined || Number.isNaN(a) || Number.isNaN(b)) return null
  return (Math.atan2(b, a) * 180) / Math.PI
}
