import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Sector } from '@/api/types.gen'
import { Wheel } from './Wheel'

const sectors: Sector[] = ['Mario', 'Celeste', 'Hades', 'Portal'].map((label) => ({ label, weight: 1, kind: '', defId: '' }))

/** jsdom does no CSS animation: report the rotor turned by `deg`. */
function rotorAt(deg: number) {
  const real = window.getComputedStyle
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
    if ((el as Element).getAttribute('data-testid') !== 'wheel-rotor') return real(el, pseudo)
    const r = (deg * Math.PI) / 180
    return { transform: `matrix(${Math.cos(r)}, ${Math.sin(r)}, ${-Math.sin(r)}, ${Math.cos(r)}, 0, 0)` } as CSSStyleDeclaration
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

it('shows the sector passing under the pointer while it turns, and clears it at the stop', async () => {
  rotorAt(100) // the top shows 260°: Portal is 270–360, Hades 180–270
  render(<Wheel sectors={sectors} target={1} />)
  const ticker = screen.getByTestId('wheel-rotor').closest('div')!.previousElementSibling!
  expect(ticker).toHaveAttribute('aria-hidden', 'true')
  await vi.waitFor(() => expect(ticker).toHaveTextContent('Hades'))

  fireEvent.animationEnd(screen.getByTestId('wheel-rotor'))
  expect(ticker).toHaveTextContent('')
})

it('keeps the line empty at rest', () => {
  rotorAt(100)
  render(<Wheel sectors={sectors} target={null} />)
  const ticker = screen.getByTestId('wheel-rotor').closest('div')!.previousElementSibling!
  expect(ticker).toHaveTextContent('')
})
