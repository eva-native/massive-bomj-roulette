import { describe, expect, it } from 'vitest'
import type { Sector } from '@/api/types.gen'
import { angleOf, sectorAt, slices } from './wheel'

const sector = (label: string, weight = 1, kind = ''): Sector => ({ label, weight, kind, defId: '' })

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
