import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { ItemIcon } from './ItemIcon'

it("shows the judge's picture, and the item's emoji when the picture does not load", () => {
  const { container, rerender } = render(<ItemIcon defId="opaaa" kind="effect" icons={{ opaaa: 'https://example.com/gone.png' }} />)
  const picture = container.querySelector('img')!
  expect(picture).toHaveAttribute('src', 'https://example.com/gone.png')

  fireEvent.error(picture)
  expect(container.querySelector('img')).toBeNull()
  expect(screen.getByText('🎉')).toBeInTheDocument()

  // A new link from the judge is tried again.
  rerender(<ItemIcon defId="opaaa" kind="effect" icons={{ opaaa: 'https://example.com/new.png' }} />)
  expect(container.querySelector('img')).toHaveAttribute('src', 'https://example.com/new.png')
})

it('uses the emoji without a picture', () => {
  render(<ItemIcon defId="opaaa" kind="effect" />)
  expect(screen.getByText('🎉')).toBeInTheDocument()
})
