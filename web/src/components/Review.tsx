import type { Ref } from 'react'
import { MaxReview } from '@/api/types.gen'
import { Folded } from './Folded'
import { cn } from '@/lib/cn'
import { reviewLength } from '@/lib/review'

/** The counter shows up when this many characters are left. */
const WARN_LEFT = 500

/**
 * A character counter for a review, shown near the limit. Put it outside the
 * field's label (Field's `after`), or it becomes part of the field name.
 */
export function ReviewCounter({ text }: { text: string }) {
  const length = reviewLength(text)
  if (MaxReview - length > WARN_LEFT) return null
  return (
    <span className={cn('self-end text-xs', length > MaxReview ? 'text-danger' : 'text-muted')}>
      {length.toLocaleString('ru-RU')} / {MaxReview.toLocaleString('ru-RU')}
    </span>
  )
}

/** A review as text; one longer than six lines is folded with a «read in full» button. */
export function ReviewText({ text, className }: { text: string; className?: string }) {
  return (
    <Folded lines={6} more="Читать полностью" watch={text} className={className}>
      {({ ref, className: clamp }) => (
        <p ref={ref as Ref<HTMLParagraphElement>} className={cn('w-full whitespace-pre-line text-stone-600 dark:text-stone-300', clamp)}>
          {text}
        </p>
      )}
    </Folded>
  )
}
