import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

describe('sector marks', () => {
  const effects: Sector[] = Array.from({ length: 37 }, (_, i) => ({ label: `Эффект номер ${i}`, weight: 1, kind: 'effect', defId: i === 0 ? 'opaaa' : `x${i}` }))
  const rotorText = () => Array.from(screen.getByTestId('wheel-rotor').querySelectorAll('text')).map((t) => t.textContent)

  /** Pretend the wheel is drawn `px` wide. */
  function drawnAt(px: number) {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private cb: ResizeObserverCallback) {}
        observe() {
          this.cb([{ contentRect: { width: px } } as ResizeObserverEntry], this as unknown as ResizeObserver)
        }
        disconnect() {}
      },
    )
  }

  it('shows item icons on a small wheel of 37 items, with the list under it', () => {
    drawnAt(320)
    render(<Wheel sectors={effects} target={null} />)
    expect(rotorText()).toContain('🎉') // ОПАААА's emoji
    expect(rotorText()).not.toContain('Эффект номер 0')
    expect(screen.getByText('Что на колесе (37)')).toBeInTheDocument()
  })

  it('names the same 37 items on a big wheel, without the list', () => {
    drawnAt(560)
    render(<Wheel sectors={effects} target={null} />)
    expect(rotorText()).toContain('Эффект номер 0')
    expect(screen.queryByText('Что на колесе (37)')).not.toBeInTheDocument()
  })

  it('falls back to the emoji when an icon picture does not load', () => {
    drawnAt(320)
    render(<Wheel sectors={effects} target={null} icons={{ opaaa: 'https://example.com/gone.png' }} />)
    const picture = screen.getByTestId('wheel-rotor').querySelector('image')!
    expect(rotorText()).not.toContain('🎉')
    fireEvent.error(picture)
    expect(rotorText()).toContain('🎉')
  })
})

it('keeps the line empty at rest', () => {
  rotorAt(100)
  render(<Wheel sectors={sectors} target={null} />)
  const ticker = screen.getByTestId('wheel-rotor').closest('div')!.previousElementSibling!
  expect(ticker).toHaveTextContent('')
})
