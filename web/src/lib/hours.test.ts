import { describe, expect, it } from 'vitest'
import { digits, formatClock, formatHours, hmsToHours, hoursToHMS } from './hours'

describe('hours', () => {
  it('keeps only digits', () => {
    expect(digits('abc')).toBe('')
    expect(digits('12ч')).toBe('12')
    expect(digits('-5,5')).toBe('55')
  })

  it('turns typed parts into hours', () => {
    expect(hmsToHours({ h: '', m: '', s: '' })).toBe(0)
    expect(hmsToHours({ h: '25', m: '30', s: '' })).toBe(25.5)
    expect(hmsToHours({ h: '0', m: '0', s: '36' })).toBeCloseTo(0.01)
    expect(hmsToHours({ h: '1', m: '60', s: '' })).toBeNull()
    expect(hmsToHours({ h: '1', m: '', s: '60' })).toBeNull()
    expect(hmsToHours({ h: '10001', m: '', s: '' })).toBeNull()
  })

  it('splits and formats stored hours', () => {
    const h = 25 + 30 / 60 + 12 / 3600
    expect(hoursToHMS(h)).toEqual({ h: '25', m: '30', s: '12' })
    expect(hoursToHMS(0.5)).toEqual({ h: '', m: '30', s: '' })
    expect(formatHours(h)).toBe('25 ч 30 мин 12 с')
    expect(formatHours(2)).toBe('2 ч')
    expect(formatHours(0)).toBe('0 с')
    expect(formatClock(3909000)).toBe('1:05:09')
  })
})
