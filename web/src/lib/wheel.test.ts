import { describe, expect, it } from 'vitest'
import type { Sector } from '@/api/types.gen'
import { angleOf, fitLabel, labelMode, sectorAt, slices } from './wheel'

const sector = (label: string, weight = 1, kind = ''): Sector => ({ label, weight, kind, defId: '' })
const items = (n: number) => slices(Array.from({ length: n }, (_, i) => ({ label: `Предмет ${i}`, weight: 1, kind: 'effect', defId: `item${i}` })))
const games = (n: number) => slices(Array.from({ length: n }, (_, i) => sector(`Игра ${i}`)))

describe('slices', () => {
  it('colours games so that no two neighbours match, the last and the first included', () => {
    for (const n of [2, 3, 8, 9, 17, 100]) {
      const parts = games(n)
      parts.forEach((p, i) => expect(p.color, `${n} sectors, #${i}`).not.toBe(parts[(i + 1) % n]!.color))
    }
  })

  it('keeps the item kinds in their colours', () => {
    const parts = slices([sector('a', 1, 'effect'), sector('b', 1, 'bonus'), sector('c', 1, 'drop')])
    expect(parts.map((p) => p.color)).toEqual(['#f59e0b', '#22c55e', '#dc2626'])
  })
})

describe('labelMode', () => {
  it('labels a small wheel with text even on a phone', () => {
    expect(labelMode(games(8), 300)).toMatchObject({ kind: 'text' })
  })

  it('gives 37 items (alphapve) full text on a big wheel and icons on a small one', () => {
    const big = labelMode(items(37), 560)
    expect(big.kind).toBe('text')
    expect(big.kind === 'text' && big.maxChars).toBeGreaterThanOrEqual(16)
    expect(labelMode(items(37), 320)).toMatchObject({ kind: 'icons' })
  })

  it('draws nothing in a hundred game sectors: the ticker names them', () => {
    expect(labelMode(games(100), 560)).toEqual({ kind: 'none' })
    expect(labelMode(games(100), 320)).toEqual({ kind: 'none' })
  })

  it('keeps labels about 12 px on screen', () => {
    const small = labelMode(games(8), 320)
    const big = labelMode(games(8), 560)
    expect(small.kind === 'text' && small.font * (320 / 320)).toBeCloseTo(12)
    expect(big.kind === 'text' && big.font * (560 / 320)).toBeCloseTo(12)
  })

  it('has nothing to show without sectors', () => {
    expect(labelMode([], 320)).toEqual({ kind: 'none' })
  })
})

describe('fitLabel', () => {
  it('keeps a short label and cuts a long one with an ellipsis', () => {
    expect(fitLabel('Mario', 10)).toBe('Mario')
    expect(fitLabel('Warcraft 3: Frozen Throne', 10)).toBe('Warcraft …')
    expect(Array.from(fitLabel('Warcraft 3: Frozen Throne', 10))).toHaveLength(10)
  })
})

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
