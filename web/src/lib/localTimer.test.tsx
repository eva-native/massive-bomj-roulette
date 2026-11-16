import { act, renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useLocalTimer } from './localTimer'

it('reports blocked storage while continuing the session in memory', () => {
  vi.useFakeTimers()
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError') })
  const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError') })
  const { result, unmount } = renderHook(() => useLocalTimer('blocked-timer'))
  try {
    expect(result.current.persistent).toBe(false)
    act(() => result.current.start())
    act(() => vi.advanceTimersByTime(2000))
    expect(result.current.ms).toBe(2000)
    act(() => result.current.pause())
    act(() => vi.advanceTimersByTime(2000))
    expect(result.current.ms).toBe(2000)
    expect(result.current.running).toBe(false)
  } finally {
    unmount()
    write.mockRestore()
    remove.mockRestore()
    vi.useRealTimers()
  }
})
