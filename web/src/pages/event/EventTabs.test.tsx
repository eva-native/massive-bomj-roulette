import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { expect, it, vi } from 'vitest'
import { EventTabs } from './EventTabs'

it('reveals the active tab when the row narrows, and lets the user scroll away from it', () => {
  let width = 900
  const rect = (left: number, right: number) => ({ left, right }) as DOMRect
  const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.tagName === 'NAV') return rect(0, width)
    return rect(500, 600)
  })
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
  const scrollWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth')
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => width })
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => 700 })
  try {
    render(<MemoryRouter><EventTabs base="/e/lbr" active="settings" tabs={[{ to: '', label: 'Таблица' }, { to: 'settings', label: 'Настройки' }]} /></MemoryRouter>)
    const row = screen.getByRole('navigation')
    expect(row.scrollLeft).toBe(0)
    width = 300
    fireEvent(window, new Event('resize'))
    expect(row.scrollLeft).toBe(316) // the active tab now fits, including a 16 px margin
    row.scrollLeft = 0
    fireEvent.scroll(row)
    expect(row.scrollLeft).toBe(0) // user scroll is not snapped back to the active tab
  } finally {
    spy.mockRestore()
    if (original) Object.defineProperty(HTMLElement.prototype, 'clientWidth', original)
    if (scrollWidth) Object.defineProperty(HTMLElement.prototype, 'scrollWidth', scrollWidth)
  }
})
