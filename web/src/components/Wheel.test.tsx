import { act, fireEvent, render, screen } from '@testing-library/react'
import indexHtml from '../../index.html?raw'
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

const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)))

describe('ticker', () => {
  it('shows the sector passing under the pointer while it turns, and clears it at the stop', async () => {
    rotorAt(100) // the top shows 260°: Portal is 270–360, Hades 180–270
    render(<Wheel sectors={sectors} target={1} />)
    const ticker = screen.getByTestId('wheel-ticker')
    expect(ticker).toHaveAttribute('aria-hidden', 'true')
    await vi.waitFor(() => expect(ticker).toHaveTextContent('Hades'))

    fireEvent.animationEnd(screen.getByTestId('wheel-rotor'))
    expect(ticker).toHaveTextContent('')
  })

  it('stops even when the spin ends at once (reduced motion)', async () => {
    rotorAt(100)
    render(<Wheel sectors={sectors} target={1} />)
    fireEvent.animationEnd(screen.getByTestId('wheel-rotor')) // before the first frame
    await wait(50)
    const reads = vi.mocked(window.getComputedStyle).mock.calls.length
    await wait(50)
    expect(vi.mocked(window.getComputedStyle).mock.calls.length).toBe(reads) // no frame loop left running
    expect(screen.getByTestId('wheel-ticker')).toHaveTextContent('')
  })

  it('takes no room at rest', () => {
    render(<Wheel sectors={sectors} target={null} />)
    expect(screen.queryByTestId('wheel-ticker')).not.toBeInTheDocument()
  })

  it('can be left out (the OBS overlay)', () => {
    render(<Wheel sectors={sectors} target={1} ticker={false} />)
    expect(screen.queryByTestId('wheel-ticker')).not.toBeInTheDocument()
  })
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

  it('keeps labels on the left half upright', () => {
    render(<Wheel sectors={sectors} target={null} />) // Mario and Celeste on the right, Hades and Portal on the left
    const label = (name: string) => screen.getByText(name, { selector: 'text' })
    expect(label('Celeste')).toHaveAttribute('text-anchor', 'end') // mid 135°: rim on the right end of the text
    expect(label('Celeste').getAttribute('transform')).toMatch(/^rotate\(45 /)
    expect(label('Hades')).toHaveAttribute('text-anchor', 'start') // mid 225°: turned over, starts at the rim
    expect(label('Hades').getAttribute('transform')).toMatch(/^rotate\(315 /)
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

it('loads pictures without a Referer: SVG images follow the page policy', () => {
  expect(indexHtml).toMatch(/<meta name="referrer" content="no-referrer"/)
})

it('tells screen readers which wheel it is and how many sectors it has', () => {
  render(<Wheel sectors={sectors} target={null} name="Колесо игр" />)
  expect(screen.getByRole('img', { name: 'Колесо игр, 4 сектора' })).toBeInTheDocument()
})
