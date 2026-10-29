import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { GameCover } from './GameCover'
import { ItemIcon } from './ItemIcon'

const a = 'https://example.com/a.png'
const b = 'https://example.com/b.png'
const icon = (url: string) => <ItemIcon defId="opaaa" kind="effect" icons={{ opaaa: url }} />

describe('ItemIcon', () => {
  it("shows the judge's picture, and the item's emoji when the picture does not load", () => {
    const { container } = render(icon(a))
    const picture = container.querySelector('img')!
    expect(picture).toHaveAttribute('src', a)
    fireEvent.error(picture)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('🎉')).toBeInTheDocument()
  })

  it('does not ask again for a link that already failed on the page', () => {
    const first = render(icon(a))
    fireEvent.error(first.container.querySelector('img')!)
    const second = render(icon(a)) // another board, the items tab…
    expect(second.container.querySelector('img')).toBeNull()
  })

  it('remembers every dead link, so a wheel ticker going A, B, A does not flash a broken picture', () => {
    const { container, rerender } = render(icon(a))
    fireEvent.error(container.querySelector('img')!)
    rerender(icon(b))
    fireEvent.error(container.querySelector('img')!)
    rerender(icon(a))
    expect(container.querySelector('img')).toBeNull()
  })

  it("does not let a late error of the previous picture mark the new one", () => {
    const { container, rerender } = render(icon(a))
    const old = container.querySelector('img')!
    rerender(icon(b))
    fireEvent.error(old) // A's error arrives after the switch
    expect(container.querySelector('img')).toHaveAttribute('src', b)
  })

  it('loads only full links, never a half-typed one', () => {
    const { container } = render(icon('htt'))
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('🎉')).toBeInTheDocument()
  })

  it('uses the emoji without a picture', () => {
    render(<ItemIcon defId="opaaa" kind="effect" />)
    expect(screen.getByText('🎉')).toBeInTheDocument()
  })
})

describe('GameCover', () => {
  it('hides a cover that does not load, and does not ask for it again', () => {
    const first = render(<GameCover url={a} title="Mario" />)
    fireEvent.error(first.container.querySelector('img')!)
    expect(first.container.querySelector('img')).toBeNull()
    const second = render(<GameCover url={a} title="Mario" />)
    expect(second.container.querySelector('img')).toBeNull()
  })
})
