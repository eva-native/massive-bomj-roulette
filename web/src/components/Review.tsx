import { useLayoutEffect, useRef, useState } from 'react'
import { MaxReview } from '@/api/types.gen'
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
  const ref = useRef<HTMLParagraphElement>(null)
  const [open, setOpen] = useState(false)
  const [folds, setFolds] = useState(false)

  // Fold only when the clamp hides something; that depends on the width.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || open) return
    const check = () => setFolds(el.scrollHeight > el.clientHeight + 1)
    check()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [text, open])

  return (
    <div className={cn('flex w-full flex-col items-start gap-1', className)}>
      <p ref={ref} className={cn('w-full whitespace-pre-line text-stone-600 dark:text-stone-300', !open && 'line-clamp-6')}>
        {text}
      </p>
      {folds && (
        <button type="button" aria-expanded={open} className="text-xs text-link hover:underline" onClick={() => setOpen(!open)}>
          {open ? 'Свернуть' : 'Читать полностью'}
        </button>
      )}
    </div>
  )
}
