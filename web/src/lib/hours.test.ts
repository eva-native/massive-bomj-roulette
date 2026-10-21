import { describe, expect, it } from 'vitest'
import { cleanHoursInput, parseHours } from './hours'

describe('cleanHoursInput', () => {
  it('drops letters and extra separators', () => {
    expect(cleanHoursInput('abc')).toBe('')
    expect(cleanHoursInput('12ч')).toBe('12')
    expect(cleanHoursInput('2,5')).toBe('2.5')
    expect(cleanHoursInput('1.2.3')).toBe('1.23')
    expect(cleanHoursInput('-5')).toBe('5')
    expect(cleanHoursInput('1e9')).toBe('19')
  })
})

describe('parseHours', () => {
  it('parses numbers in range', () => {
    expect(parseHours('')).toBe(0)
    expect(parseHours('25')).toBe(25)
    expect(parseHours('2.5')).toBe(2.5)
    expect(parseHours('.')).toBeNull()
    expect(parseHours('10001')).toBeNull()
  })
})
