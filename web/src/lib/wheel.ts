import type { EventSettings, Sector } from '@/api/types.gen'

/** The wheel's default spin, in seconds. */
export const DEFAULT_WHEEL_SECONDS = 4.5

/** How long a wheel of this kind turns in the event (games and movies share one setting). */
export function wheelSeconds(settings: EventSettings | undefined, kind: string): number {
  const s = kind === 'games' || kind === 'movies' ? settings?.gameWheelSeconds : settings?.itemWheelSeconds
  return s && s > 0 ? s : DEFAULT_WHEEL_SECONDS
}

/** The name of each kind of wheel (`WheelView.kind`). */
export const wheelNames: Record<string, string> = {
  items: 'Колесо эффектов и бонусов',
  drops: 'Колесо дроп-дебаффов',
  games: 'Колесо игр',
  movies: 'Киноколесо',
}

/** The wheel's drawing in SVG units: the viewBox side and the radius of the sectors. */
export const WHEEL_SIZE = 320
export const WHEEL_R = WHEEL_SIZE / 2 - 6

/**
 * Item kinds keep their colours: they mean something (effect, bonus, drop
 * debuff). Sectors alternate the first two shades; the third is for the last
 * sector when it would match the first one.
 */
const kindColors: Record<string, [string, string, string]> = {
  effect: ['#f59e0b', '#fbbf24', '#d97706'],
  bonus: ['#16a34a', '#22c55e', '#15803d'],
  drop: ['#dc2626', '#ef4444', '#b91c1c'],
}

/**
 * Games and movies: the colours mean nothing and only tell neighbours apart,
 * so the wheel's turn is visible. Mid tones, not glaring on a dark card.
 */
export const plainColors = ['#7aa2c8', '#d4a05a', '#9f8bd0', '#6fb59a', '#d18a9c', '#a8b25c', '#5fb0c4', '#c99b7a']

/** Every colour a sector can have. */
export const sectorColors = [...Object.values(kindColors).flat(), ...plainColors]

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

/** WCAG contrast ratio of two #rrggbb colours. */
export function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

const DARK_TEXT = '#1c1917'
const LIGHT_TEXT = '#ffffff'

/** The text colour that reads best on a sector of this colour. */
export function labelColor(fill: string) {
  return contrast(fill, DARK_TEXT) >= contrast(fill, LIGHT_TEXT) ? DARK_TEXT : LIGHT_TEXT
}

/** A sector with its place on the wheel: degrees clockwise from the top. */
export type Slice = { start: number; end: number; sector: Sector; color: string }

export function slices(sectors: Sector[]): Slice[] {
  const total = sectors.reduce((sum, s) => sum + Math.max(s.weight, 0), 0) || 1
  let at = 0
  const parts = sectors.map((sector, i) => {
    const span = (Math.max(sector.weight, 0) / total) * 360
    const shades = kindColors[sector.kind]
    const color = shades ? shades[i % 2]! : plainColors[i % plainColors.length]!
    const s = { start: at, end: at + span, sector, color }
    at += span
    return s
  })
  // The last sector touches the first, right under the pointer at rest: never the same colour.
  const first = parts[0]
  const last = parts.at(-1)
  const beforeLast = parts.at(-2)
  if (first && last && beforeLast && last !== first && last.color === first.color) {
    const choices = kindColors[last.sector.kind] ?? plainColors
    last.color = choices.find((c) => c !== first.color && c !== beforeLast.color) ?? last.color
  }
  return parts
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

/** What one sector shows: its label (cut to fit), its item icon, or nothing when it is too narrow. */
export type SectorMark = { kind: 'text'; text: string; cut: boolean } | { kind: 'icon' } | null

/**
 * The plan for a wheel's sectors: the mode, the sizes in SVG units (about
 * LABEL_PX and ICON_PX on screen), one mark per sector, and whether the list
 * of what is on the wheel is needed (some names are not shown in full).
 */
export type LabelPlan = {
  kind: 'text' | 'icons' | 'none'
  font: number
  icon: number
  marks: SectorMark[]
  legend: boolean
}

/**
 * What fits into the sectors of a wheel drawn `px` wide. A label runs from
 * the rim towards the hub and must stop where its sector becomes thinner than
 * a line of text. The mode follows a typical (median) sector, so one narrow
 * sector (a lower weight) does not take the labels off the whole wheel: text
 * when at least 10 characters fit; otherwise item icons if every sector has
 * one and they fit; otherwise shorter text; otherwise nothing. Then each
 * sector gets what fits in its own width, and one too narrow stays empty.
 */
export function labelPlan(parts: Slice[], px: number): LabelPlan {
  const scale = px > 0 ? px / WHEEL_SIZE : 1
  const font = Math.min(Math.max(LABEL_PX / scale, 6), 13)
  const icon = ICON_PX / scale
  const radians = (span: number) => (span * Math.PI) / 180
  const charsFor = (span: number) => {
    if (span <= 0) return 0
    const start = Math.min(Math.max((1.15 * font) / radians(span), HUB_CLEARANCE), LABEL_OUTER)
    return Math.floor((LABEL_OUTER - start) / (0.56 * font)) // 0.56: an average glyph's width per unit of font size
  }
  const iconFits = (span: number) => span > 0 && ICON_RADIUS * radians(span) >= 1.2 * icon

  const spans = parts.map((p) => p.end - p.start)
  const sorted = spans.filter((s) => s > 0).sort((a, b) => a - b)
  const typical = sorted[Math.floor(sorted.length / 2)]
  const none: LabelPlan = { kind: 'none', font, icon, marks: parts.map(() => null), legend: true }
  if (typical === undefined || px <= 0) return none

  const chars = charsFor(typical)
  const kind = chars >= 10 ? 'text' : parts.every((p) => p.sector.defId) && iconFits(typical) ? 'icons' : chars >= 6 ? 'text' : 'none'
  if (kind === 'none') return none

  const marks: SectorMark[] = parts.map((p, i) => {
    const span = spans[i]!
    if (kind === 'icons') return iconFits(span) ? { kind: 'icon' } : null
    const fits = charsFor(span)
    if (fits < 3) return null
    return { kind: 'text', text: fitLabel(p.sector.label, fits), cut: Array.from(p.sector.label).length > fits }
  })
  // Icons need their names next to them; a cut or missing label needs the full one.
  const legend = kind === 'icons' || marks.some((m) => m === null || (m.kind === 'text' && m.cut))
  return { kind, font, icon, marks, legend }
}

/**
 * A sector's chance as shown in the list, from its span in degrees: whole
 * percents, one decimal below 1 % (a game among a hundred is 0,8 %, not 1 %).
 */
export function chance(span: number): string {
  const pct = (span / 360) * 100
  if (pct >= 1) return `${Math.round(pct)}%`
  if (pct < 0.05) return '<0,1%'
  return `${pct.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`
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
