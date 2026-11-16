import { act, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ActivityTime } from './ActivityTime'

it('updates recent dates and keeps the full timestamp available', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-16T10:00:00Z'))
  const { unmount } = render(<ActivityTime at="2026-11-16T09:59:30Z" />)
  expect(screen.getByText('только что')).toHaveAttribute('dateTime', '2026-11-16T09:59:30.000Z')
  act(() => vi.advanceTimersByTime(60_000))
  expect(screen.getByText('1 минуту назад')).toHaveAttribute('title')
  unmount()
  expect(vi.getTimerCount()).toBe(0)
  vi.useRealTimers()
})
