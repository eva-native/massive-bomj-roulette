import { describe, expect, it } from 'vitest'
import type { Sector } from '@/api/types.gen'
import { angleOf, chance, contrast, fitLabel, labelColor, labelPlan, sectorAt, sectorColors, slices } from './wheel'

const sector = (label: string, weight = 1, kind = ''): Sector => ({ label, weight, kind, defId: '' })
const item = (i: number, weight = 1, kind = 'effect'): Sector => ({ label: `Предмет ${i}`, weight, kind, defId: `item${i}` })
const items = (n: number) => slices(Array.from({ length: n }, (_, i) => item(i)))
const games = (n: number, name = (i: number) => `Игра ${i}`) => slices(Array.from({ length: n }, (_, i) => sector(name(i))))

describe('sectorAt', () => {
  // Four equal sectors: A 0–90°, B 90–180°, C 180–270°, D 270–360°, clockwise from the top.
  const parts = slices([sector('A'), sector('B'), sector('C'), sector('D')])

  it('finds the sector at the top of a wheel at rest', () => {
    expect(sectorAt(parts, 0)).toBe(0)
  })

  it('turning clockwise brings the sectors before it under the pointer', () => {
    expect(sectorAt(parts, 10)).toBe(3) // the top now shows 350°
    expect(sectorAt(parts, 100)).toBe(2) // 260°
    expect(sectorAt(parts, 260)).toBe(1) // 100°
  })

  it('works across many full turns and with negative angles', () => {
    expect(sectorAt(parts, 6 * 360 + 100)).toBe(2)
    expect(sectorAt(parts, -100)).toBe(1) // matrices report -180..180
  })

  it('respects the weights', () => {
    const weighted = slices([sector('big', 3), sector('small', 1)]) // big 0–270°, small 270–360°
    expect(sectorAt(weighted, 45)).toBe(1) // 315°
    expect(sectorAt(weighted, 135)).toBe(0) // 225°
  })
})

describe('angleOf', () => {
  const matrix = (deg: number) => {
    const r = (deg * Math.PI) / 180
    return `matrix(${Math.cos(r)}, ${Math.sin(r)}, ${-Math.sin(r)}, ${Math.cos(r)}, 0, 0)`
  }

  it('reads the rotation of a computed transform', () => {
    expect(angleOf(matrix(30))).toBeCloseTo(30)
    expect(angleOf(matrix(200))).toBeCloseTo(-160)
  })

  it('reads a 3D matrix too', () => {
    expect(angleOf('matrix3d(0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)')).toBeCloseTo(90)
  })

  it('has nothing to read without a transform', () => {
    expect(angleOf('none')).toBeNull()
    expect(angleOf('')).toBeNull()
  })
})

describe('slices', () => {
  const neighboursDiffer = (parts: ReturnType<typeof slices>) =>
    parts.forEach((p, i) => expect(p.color, `${parts.length} sectors, #${i}`).not.toBe(parts[(i + 1) % parts.length]!.color))

  it('colours games so that no two neighbours match, the last and the first included', () => {
    for (const n of [2, 3, 8, 9, 17, 100]) neighboursDiffer(games(n))
  })

  it('does the same on an item wheel with an odd number of sectors', () => {
    for (const n of [3, 37]) neighboursDiffer(items(n))
    neighboursDiffer(slices([item(0, 1, 'bonus'), item(1, 1, 'effect'), item(2, 1, 'bonus')]))
  })

  it('keeps the item kinds in their colours', () => {
    const parts = slices([sector('a', 1, 'effect'), sector('b', 1, 'bonus'), sector('c', 1, 'drop')])
    expect(parts.map((p) => p.color)).toEqual(['#f59e0b', '#22c55e', '#dc2626'])
  })
})

describe('labelColor', () => {
  it('reads at 4.5:1 or better on every sector colour', () => {
    for (const fill of sectorColors) expect(contrast(fill, labelColor(fill)), fill).toBeGreaterThanOrEqual(4.5)
  })

  it('writes white on the red of drop debuffs and dark on amber effects', () => {
    expect(labelColor('#dc2626')).toBe('#ffffff')
    expect(labelColor('#f59e0b')).toBe('#1c1917')
  })
})

describe('labelPlan', () => {
  const texts = (plan: ReturnType<typeof labelPlan>) => plan.marks.map((m) => (m?.kind === 'text' ? m.text : m?.kind ?? null))

  it('labels a small wheel with text even on a phone, without the list', () => {
    const plan = labelPlan(games(8), 300)
    expect(plan.kind).toBe('text')
    expect(texts(plan)).toContain('Игра 0')
    expect(plan.legend).toBe(false)
  })

  it('gives 37 items (alphapve) full text on a big wheel and icons on a small one', () => {
    const big = labelPlan(items(37), 560)
    expect(big.kind).toBe('text')
    expect(texts(big)).toContain('Предмет 12')
    expect(big.legend).toBe(false)

    const small = labelPlan(items(37), 320)
    expect(small.kind).toBe('icons')
    expect(small.legend).toBe(true) // icons need their names
  })

  it('draws nothing in a hundred game sectors: the ticker and the list name them', () => {
    for (const px of [560, 320]) {
      const plan = labelPlan(games(100), px)
      expect(plan.kind).toBe('none')
      expect(plan.marks.every((m) => m === null)).toBe(true)
      expect(plan.legend).toBe(true)
    }
  })

  it('shows the list when names are cut', () => {
    const plan = labelPlan(games(35, (i) => `Hollow Knight: Silksong ${i}`), 320)
    expect(plan.kind).toBe('text')
    expect(plan.marks.some((m) => m?.kind === 'text' && m.cut && m.text.endsWith('…'))).toBe(true)
    expect(plan.legend).toBe(true)
  })

  it('keeps the labels when one sector has a lower weight; only that one goes without', () => {
    const parts = slices([...Array.from({ length: 36 }, (_, i) => item(i, 3)), item(36, 1)])
    const plan = labelPlan(parts, 560)
    expect(plan.kind).toBe('text')
    expect(plan.marks.slice(0, 36).every((m) => m?.kind === 'text')).toBe(true)
    expect(plan.marks[36]).toBeNull()
    expect(plan.legend).toBe(true) // its name is only in the list
  })

  it('keeps labels about 12 px on screen', () => {
    expect(labelPlan(games(8), 320).font).toBeCloseTo(12)
    expect(labelPlan(games(8), 560).font * (560 / 320)).toBeCloseTo(12)
  })

  it('has nothing to show without sectors', () => {
    expect(labelPlan([], 320)).toMatchObject({ kind: 'none', marks: [] })
  })
})

describe('chance', () => {
  it('shows whole percents, and one decimal below 1 %', () => {
    expect(chance(90)).toBe('25%')
    expect(chance(360 / 37)).toBe('3%')
    expect(chance(360 / 120)).toBe('0,8%')
    expect(chance(0.01)).toBe('<0,1%')
  })
})

describe('fitLabel', () => {
  it('keeps a short label and cuts a long one with an ellipsis', () => {
    expect(fitLabel('Mario', 10)).toBe('Mario')
    expect(fitLabel('Warcraft 3: Frozen Throne', 10)).toBe('Warcraft …')
    expect(Array.from(fitLabel('Warcraft 3: Frozen Throne', 10))).toHaveLength(10)
  })
})
