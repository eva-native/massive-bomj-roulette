import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { MaxReview } from '@/api/types.gen'
import { reviewLength, reviewTooLong } from '@/lib/review'
import { ReviewCounter, ReviewText } from './Review'
import { Field, Textarea } from './ui'

// jsdom does no layout: pretend the clamped paragraph is this tall inside.
function fakeScrollHeight(px: number) {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => px })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 100 })
}

afterEach(() => {
  delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight
})

it('counts a review the way the server does', () => {
  expect(reviewLength('  Классика\n')).toBe(8) // spaces at the ends do not count
  expect(reviewLength('🎮🎮')).toBe(2) // an emoji is one character, not two
  expect(reviewTooLong('🎮'.repeat(MaxReview))).toBe(false)
  expect(reviewTooLong('я'.repeat(MaxReview + 1))).toBe(true)
})

it('folds a review the clamp cuts and opens it on request', () => {
  fakeScrollHeight(300)
  render(<ReviewText text={'Очень много слов. '.repeat(100)} />)
  const text = screen.getByText(/Очень много слов/)
  expect(text).toHaveClass('line-clamp-6')
  const button = screen.getByRole('button', { name: 'Читать полностью' })
  expect(button).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(button)
  expect(text).not.toHaveClass('line-clamp-6')
  expect(screen.getByRole('button', { name: 'Свернуть' })).toHaveAttribute('aria-expanded', 'true')
})

it('has no fold button when the whole review fits', () => {
  fakeScrollHeight(100)
  render(<ReviewText text={'Длинный абзац на широком экране. '.repeat(20)} />)
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})

it('counts characters only near the limit, outside the field name', () => {
  const field = (text: string) => (
    <Field label="Обзор" after={<ReviewCounter text={text} />}>
      <Textarea value={text} onChange={() => {}} />
    </Field>
  )
  const { rerender } = render(field('Норм'))
  expect(screen.queryByText(/\/ 10/)).not.toBeInTheDocument()

  rerender(field('я'.repeat(MaxReview - 100)))
  expect(screen.getByText('9 900 / 10 000')).toHaveClass('text-stone-500')
  expect(screen.getByRole('textbox', { name: 'Обзор' })).toBeInTheDocument()

  rerender(field('я'.repeat(MaxReview + 1)))
  expect(screen.getByText('10 001 / 10 000')).toHaveClass('text-red-600')
})
