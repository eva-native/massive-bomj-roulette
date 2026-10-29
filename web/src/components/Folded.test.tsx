import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { Ref } from 'react'
import { Folded } from './Folded'
import { RuleText } from './RuleText'

// jsdom does no layout: pretend the clamped text is this tall inside.
function fakeScrollHeight(px: number) {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => px })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 60 })
}

afterEach(() => {
  delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight
})

const rule = 'Если у игры есть режим совместного прохождения, можешь позвать в подмогу любого участника. [Подробнее о режиме](https://example.com).'

const folded = () => (
  <Folded lines={3} more="Подробнее" watch={rule}>
    {({ ref, className }) => <RuleText ref={ref as Ref<HTMLParagraphElement>} text={rule} className={className} />}
  </Folded>
)

it('folds an item rule to three lines, links kept, and opens it', () => {
  fakeScrollHeight(200)
  render(folded())
  const text = screen.getByText(/режим совместного прохождения/)
  expect(text).toHaveClass('line-clamp-3')
  expect(screen.getByRole('link', { name: 'Подробнее о режиме' })).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Подробнее' }))
  expect(text).not.toHaveClass('line-clamp-3')
  expect(screen.getByRole('button', { name: 'Свернуть' })).toHaveAttribute('aria-expanded', 'true')
})

it('has no button when the rule fits', () => {
  fakeScrollHeight(60)
  render(folded())
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})
