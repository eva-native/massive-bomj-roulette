import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ScrollToBottom } from './ScrollToBottom'

// jsdom has no layout: give the page a height by hand.
function setPageHeight(px: number) {
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: px })
}

function scrollPageTo(y: number) {
  act(() => {
    window.scrollY = y
    window.dispatchEvent(new Event('scroll'))
  })
}

const button = () => screen.getByRole('button', { name: 'Вниз страницы' })

afterEach(() => {
  setPageHeight(0)
  window.scrollY = 0
})

it('is hidden on a short page', () => {
  setPageHeight(window.innerHeight + 100)
  render(<ScrollToBottom />)
  expect(button()).toHaveAttribute('data-shown', 'false')
  expect(button()).toHaveAttribute('tabindex', '-1')
})

it('jumps to the bottom of a long page and hides near it, keeping the focus', () => {
  setPageHeight(window.innerHeight * 5)
  const scroll = vi.fn()
  vi.stubGlobal('scrollTo', scroll)
  render(<ScrollToBottom />)
  expect(button()).toHaveAttribute('data-shown', 'true')

  button().focus()
  fireEvent.click(button())
  expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ top: window.innerHeight * 5 }))

  scrollPageTo(window.innerHeight * 4)
  expect(button()).toHaveAttribute('data-shown', 'false')
  expect(button()).toHaveFocus()
})
