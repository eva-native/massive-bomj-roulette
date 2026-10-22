import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ScrollToBottom } from './ScrollToBottom'

// jsdom has no layout: give the page a height by hand.
function setPageHeight(px: number) {
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: px })
}

afterEach(() => {
  setPageHeight(0)
  window.scrollY = 0
})

it('is hidden on a short page', () => {
  setPageHeight(window.innerHeight + 100)
  render(<ScrollToBottom />)
  expect(screen.queryByRole('button', { name: 'Вниз страницы' })).not.toBeInTheDocument()
})

it('jumps to the bottom of a long page and hides near it', () => {
  setPageHeight(window.innerHeight * 5)
  const scrollTo = vi.fn()
  vi.stubGlobal('scrollTo', scrollTo)
  render(<ScrollToBottom />)

  fireEvent.click(screen.getByRole('button', { name: 'Вниз страницы' }))
  expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: window.innerHeight * 5 }))

  act(() => {
    window.scrollY = window.innerHeight * 4
    window.dispatchEvent(new Event('scroll'))
  })
  expect(screen.queryByRole('button', { name: 'Вниз страницы' })).not.toBeInTheDocument()
})
