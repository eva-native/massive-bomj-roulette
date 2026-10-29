import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import type { Sector } from '@/api/types.gen'
import { cn } from '@/lib/cn'
import { itemEmoji, kindEmoji } from '@/lib/items'
import { plural } from '@/lib/plural'
import { angleOf, chance, ICON_RADIUS, LABEL_OUTER, labelColor, labelPlan, sectorAt, slices, WHEEL_R as R, WHEEL_SIZE as SIZE, type LabelPlan, type Slice } from '@/lib/wheel'
import { ItemIcon } from './ItemIcon'

const TURNS = 6 // full turns before stopping

/**
 * The element's width on screen, kept up to date; `fallback` where nothing
 * can measure it (tests). Measured before the first paint, so a wheel never
 * shows the labels or the list of a wrong size for a frame.
 */
function useWidth(ref: RefObject<HTMLElement | null>, fallback: number) {
  const [width, setWidth] = useState(fallback)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const now = el.getBoundingClientRect().width
    if (now > 0) setWidth(now)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0) setWidth(entry.contentRect.width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return width
}

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
  ticker = true,
  action,
  name = 'Колесо',
  className,
}: {
  sectors: Sector[]
  target: number | null
  onStop?: () => void
  /** How long the spin lasts; the CSS default when not set. */
  seconds?: number
  /** Item pictures from the event settings, for the sectors, the ticker and the list. */
  icons?: Record<string, string>
  /** List the sectors under the wheel when their names are not all shown on it in full. */
  legend?: boolean
  /** Name the sector under the pointer above the wheel while it turns. */
  ticker?: boolean
  /** A control placed right under the wheel, above the list (the spin button). */
  action?: ReactNode
  /** What the wheel is, for screen readers: «Колесо игр». */
  name?: string
  /** Its size: 320 px wide unless overridden (`max-w-[560px]`). Everything inside scales with it. */
  className?: string
}) {
  const parts = useMemo(() => slices(sectors), [sectors])
  const rotor = useRef<SVGGElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const width = useWidth(frame, SIZE)
  const plan = labelPlan(parts, width)
  const spinning = target !== null && parts[target] !== undefined
  // The stop comes through React's onAnimationEnd, which cannot miss it; a
  // reduced-motion spin of 1 ms ends before any effect could listen for it.
  const [stoppedAt, setStoppedAt] = useState<number | null>(null)
  const turning = spinning && stoppedAt !== target
  const style = spinning
    ? ({ '--wheel-to': `${finalAngle(parts, target)}deg`, ...(seconds ? { '--wheel-duration': `${seconds}s` } : {}) } as CSSProperties)
    : undefined

  return (
    <div className={cn('mx-auto w-full max-w-80', className)}>
      {/* Only a spinning wheel has the line, so a wheel at rest and the overlay keep their layout. */}
      {ticker && spinning && <Ticker rotor={rotor} parts={parts} turning={turning} icons={icons} />}
      <div ref={frame} role="img" aria-label={`${name}, ${sectors.length} ${plural(sectors.length, 'сектор', 'сектора', 'секторов')}`}>
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-full drop-shadow">
          <g
            ref={rotor}
            className={spinning ? 'wheel-spin' : undefined}
            style={style}
            onAnimationEnd={() => {
              setStoppedAt(target)
              onStop?.()
            }}
            data-testid="wheel-rotor"
          >
            {parts.map((p, i) => (
              <path key={i} d={arc(p.start, p.end)} fill={p.color} stroke="#1c1917" strokeWidth={1} />
            ))}
            <SectorMarks parts={parts} plan={plan} icons={icons} />
          </g>
          <circle cx={SIZE / 2} cy={SIZE / 2} r={14} fill="#1c1917" />
          {/* The pointer at the top, drawn in the wheel's units so it grows with it. */}
          <polygon points={`${SIZE / 2 - 12},0 ${SIZE / 2 + 12},0 ${SIZE / 2},22`} className="fill-stone-900 dark:fill-stone-100" data-testid="wheel-pointer" />
        </svg>
      </div>
      {action && <div className="mt-3 flex justify-center">{action}</div>}
      {legend && plan.legend && <Legend parts={parts} icons={icons} />}
    </div>
  )
}

/**
 * What each sector shows (see labelPlan): a label running from the rim
 * towards the hub, the item's icon near the rim, or nothing. An icon picture
 * that fails to load falls back to the item's emoji.
 */
function SectorMarks({ parts, plan, icons }: { parts: Slice[]; plan: LabelPlan; icons?: Record<string, string> }) {
  const [broken, setBroken] = useState<ReadonlySet<string>>(() => new Set())
  return parts.map((p, i) => {
    const mark = plan.marks[i]
    if (!mark) return null
    const mid = (p.start + p.end) / 2
    if (mark.kind === 'text') {
      const [x, y] = point(mid, LABEL_OUTER)
      // On the left half a label along the radius would be upside down: turn it over, so it
      // reads from the rim inwards and stays upright while the wheel is at rest.
      const left = mid > 180
      return (
        <text
          key={i}
          x={x}
          y={y}
          fontSize={plan.font}
          fontWeight={600}
          fill={labelColor(p.color)}
          textAnchor={left ? 'start' : 'end'}
          dominantBaseline="middle"
          transform={`rotate(${left ? mid + 90 : mid - 90} ${x} ${y})`}
        >
          {mark.text}
        </text>
      )
    }
    const [x, y] = point(mid, ICON_RADIUS)
    const url = icons?.[p.sector.defId]
    if (url && !broken.has(url)) {
      const s = plan.icon
      return (
        <image
          key={i}
          href={url}
          x={x - s / 2}
          y={y - s / 2}
          width={s}
          height={s}
          preserveAspectRatio="xMidYMid slice"
          // No Referer is sent, as for ItemIcon's <img>: the page's policy in index.html covers SVG images.
          onError={() => setBroken((b) => new Set(b).add(url))}
        />
      )
    }
    return (
      <text key={i} x={x} y={y} fontSize={plan.icon} textAnchor="middle" dominantBaseline="central">
        {itemEmoji[p.sector.defId] ?? kindEmoji[p.sector.kind] ?? '❔'}
      </text>
    )
  })
}

/**
 * The sector passing under the pointer while the wheel turns, read from the
 * rotor's live rotation on every frame. Labels do not fit on a dense wheel
 * (a game wheel of a hundred titles), so this line is what can be read. It
 * empties at the stop: the page shows the result itself. Kept out of the
 * wheel's render, so its updates do not redraw the sectors.
 */
const Ticker = memo(function Ticker({
  rotor,
  parts,
  turning,
  icons,
}: {
  rotor: RefObject<SVGGElement | null>
  parts: Slice[]
  turning: boolean
  icons?: Record<string, string>
}) {
  const [pointed, setPointed] = useState<number | null>(null)

  useEffect(() => {
    const el = rotor.current
    if (!turning || !el) return
    let frame = 0
    const read = () => {
      const angle = angleOf(getComputedStyle(el).transform)
      setPointed(sectorAt(parts, angle ?? 0))
      frame = requestAnimationFrame(read)
    }
    frame = requestAnimationFrame(read)
    return () => {
      cancelAnimationFrame(frame)
      setPointed(null)
    }
  }, [rotor, parts, turning])

  const sector = pointed === null ? undefined : parts[pointed]?.sector
  // Screen readers get the result from the page; this line changes many times a second.
  return (
    <div aria-hidden data-testid="wheel-ticker" className="mb-1 flex h-8 items-center justify-center gap-2 text-lg font-semibold">
      {sector && (
        <>
          {sector.defId && <ItemIcon defId={sector.defId} kind={sector.kind} icons={icons} size="sm" />}
          <span className="truncate">{sector.label}</span>
        </>
      )}
    </div>
  )
})

/** The list of sectors with their chance, for wheels that do not show every name in full. Sorted by name: the wheel itself is shuffled. */
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
            <span className="text-xs text-stone-500">{chance(p.end - p.start)}</span>
          </li>
        ))}
      </ul>
    </details>
  )
}
