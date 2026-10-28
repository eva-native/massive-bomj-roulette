import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
import type { Sector } from '@/api/types.gen'
import { angleOf, sectorAt, slices, WHEEL_R as R, WHEEL_SIZE as SIZE, type Slice } from '@/lib/wheel'
import { ItemIcon } from './ItemIcon'

const TURNS = 6 // full turns before stopping
const MAX_LABELS = 28 // beyond this the labels are unreadable

function point(deg: number, r = R) {
  const rad = ((deg - 90) * Math.PI) / 180
  return [SIZE / 2 + r * Math.cos(rad), SIZE / 2 + r * Math.sin(rad)] as const
}

function arc(start: number, end: number) {
  if (end - start >= 359.99) return `M ${SIZE / 2} ${SIZE / 2 - R} A ${R} ${R} 0 1 1 ${SIZE / 2 - 0.01} ${SIZE / 2 - R} Z`
  const [x1, y1] = point(start)
  const [x2, y2] = point(end)
  const large = end - start > 180 ? 1 : 0
  return `M ${SIZE / 2} ${SIZE / 2} L ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} Z`
}

/** The rotation that stops sector `i` under the pointer after a few full turns. */
function finalAngle(parts: Slice[], i: number) {
  const s = parts[i]!
  // Stop a little off-centre so it looks natural; derived from the index to stay pure.
  const offset = (s.end - s.start) * ((((i * 37) % 50) - 25) / 100)
  const stop = (((-(s.start + s.end) / 2 - offset) % 360) + 360) % 360
  return TURNS * 360 + stop
}

/**
 * A wheel of fortune. The server decides the result; when `target` is set the
 * wheel turns until that sector stops under the pointer, then calls onStop.
 * The animation is pure CSS (see .wheel-spin in index.css); reduced motion
 * makes it instant.
 */
export function Wheel({
  sectors,
  target,
  onStop,
  seconds,
  icons,
  legend = true,
}: {
  sectors: Sector[]
  target: number | null
  onStop?: () => void
  /** How long the spin lasts; the CSS default when not set. */
  seconds?: number
  /** Item pictures from the event settings, for the legend. */
  icons?: Record<string, string>
  /** List the sectors under the wheel when their labels do not fit on it. */
  legend?: boolean
}) {
  const parts = useMemo(() => slices(sectors), [sectors])
  const rotor = useRef<SVGGElement>(null)
  const spinning = target !== null && parts[target] !== undefined
  const style = spinning
    ? ({ '--wheel-to': `${finalAngle(parts, target)}deg`, ...(seconds ? { '--wheel-duration': `${seconds}s` } : {}) } as CSSProperties)
    : undefined

  const showLabels = parts.length <= MAX_LABELS

  return (
    <div className="mx-auto w-full max-w-80">
      <Ticker rotor={rotor} parts={parts} spinning={spinning} icons={icons} />
      <div className="relative" role="img" aria-label={`Колесо: ${sectors.length} секторов`}>
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-full drop-shadow">
          <g ref={rotor} className={spinning ? 'wheel-spin' : undefined} style={style} onAnimationEnd={() => onStop?.()} data-testid="wheel-rotor">
            {parts.map((p, i) => (
              <path key={i} d={arc(p.start, p.end)} fill={p.color} stroke="#1c1917" strokeWidth={1} />
            ))}
            {showLabels &&
              parts.map((p, i) => {
                const mid = (p.start + p.end) / 2
                const [x, y] = point(mid, R * 0.6)
                const label = p.sector.label.length > 16 ? p.sector.label.slice(0, 15) + '…' : p.sector.label
                return (
                  <text
                    key={i}
                    x={x}
                    y={y}
                    fontSize={parts.length > 16 ? 9 : 11}
                    fontWeight={600}
                    fill="#1c1917"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    transform={`rotate(${mid - 90} ${x} ${y})`}
                  >
                    {label}
                  </text>
                )
              })}
          </g>
          <circle cx={SIZE / 2} cy={SIZE / 2} r={14} fill="#1c1917" />
        </svg>
        {/* The pointer at the top. */}
        <div className="absolute top-0 left-1/2 h-0 w-0 -translate-x-1/2 border-x-[12px] border-t-[22px] border-x-transparent border-t-stone-900 dark:border-t-stone-100" />
      </div>
      {legend && !showLabels && <Legend parts={parts} icons={icons} />}
    </div>
  )
}

/**
 * The sector passing under the pointer while the wheel turns, read from the
 * rotor's live rotation on every frame. Labels do not fit on a dense wheel
 * (a game wheel of a hundred titles), so this line is what can be read. It
 * is blank at rest and after the stop: the page shows the result itself.
 * Kept out of the wheel's render, so its updates do not redraw the sectors.
 */
const Ticker = memo(function Ticker({
  rotor,
  parts,
  spinning,
  icons,
}: {
  rotor: RefObject<SVGGElement | null>
  parts: Slice[]
  spinning: boolean
  icons?: Record<string, string>
}) {
  const [pointed, setPointed] = useState<number | null>(null)

  useEffect(() => {
    const el = rotor.current
    if (!spinning || !el) return
    let frame = 0
    const read = () => {
      const angle = angleOf(getComputedStyle(el).transform)
      setPointed(sectorAt(parts, angle ?? 0))
      frame = requestAnimationFrame(read)
    }
    const stop = () => {
      cancelAnimationFrame(frame)
      setPointed(null)
    }
    frame = requestAnimationFrame(read)
    el.addEventListener('animationend', stop)
    return () => {
      cancelAnimationFrame(frame)
      el.removeEventListener('animationend', stop)
      setPointed(null)
    }
  }, [rotor, parts, spinning])

  const sector = pointed === null ? undefined : parts[pointed]?.sector
  // Screen readers get the result from the page; this line changes many times a second.
  return (
    <div aria-hidden className="mb-1 flex h-8 items-center justify-center gap-2 text-lg font-semibold">
      {sector && (
        <>
          {sector.defId && <ItemIcon defId={sector.defId} kind={sector.kind} icons={icons} size="sm" />}
          <span className="truncate">{sector.label}</span>
        </>
      )}
    </div>
  )
})

/** The list of sectors with their chance, for wheels too dense to label. Sorted by name: the wheel itself is shuffled. */
function Legend({ parts, icons }: { parts: Slice[]; icons?: Record<string, string> }) {
  const sorted = useMemo(() => [...parts].sort((a, b) => a.sector.label.localeCompare(b.sector.label, 'ru')), [parts])
  return (
    <details className="mt-2 text-sm">
      <summary className="cursor-pointer text-center text-stone-500">Что на колесе ({parts.length})</summary>
      <ul className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
        {sorted.map((p, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="size-3 shrink-0 rounded-full border border-stone-900" style={{ background: p.color }} />
            {p.sector.defId && <ItemIcon defId={p.sector.defId} kind={p.sector.kind} icons={icons} size="sm" />}
            <span className="flex-1 truncate">{p.sector.label}</span>
            <span className="text-xs text-stone-500">{Math.round(((p.end - p.start) / 360) * 100)}%</span>
          </li>
        ))}
      </ul>
    </details>
  )
}
