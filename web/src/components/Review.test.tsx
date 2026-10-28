import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { MAX_REVIEW, ReviewInput, ReviewText } from './Review'

it('folds a long review and opens it on request', () => {
  render(<ReviewText text={'Очень много слов. '.repeat(100)} />)
  const text = screen.getByText(/Очень много слов/)
  expect(text).toHaveClass('line-clamp-6')
  fireEvent.click(screen.getByRole('button', { name: 'Читать полностью' }))
  expect(text).not.toHaveClass('line-clamp-6')
  expect(screen.getByRole('button', { name: 'Свернуть' })).toBeInTheDocument()
})

it('leaves a short review as it is', () => {
  render(<ReviewText text="Классика" />)
  expect(screen.getByText('Классика')).not.toHaveClass('line-clamp-6')
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})

it('counts characters only near the limit', () => {
  const { rerender } = render(<ReviewInput aria-label="Обзор" value="Норм" onChange={() => {}} />)
  expect(screen.getByLabelText('Обзор')).toHaveAttribute('maxlength', String(MAX_REVIEW))
  expect(screen.queryByText(/\/ 10/)).not.toBeInTheDocument()
  rerender(<ReviewInput aria-label="Обзор" value={'я'.repeat(MAX_REVIEW - 100)} onChange={() => {}} />)
  expect(screen.getByText(/\/ 10/)).toBeInTheDocument()
})
