import { useState, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'
import { Textarea } from './ui'

/** Longest game review, in characters; the server checks the same value (play.maxReview). */
export const MAX_REVIEW = 10000

/** The counter shows up when this many characters are left. */
const WARN_LEFT = 500

/** A review textarea that counts characters near the limit. */
export function ReviewInput({ value, ...props }: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'maxLength'> & { value: string }) {
  const left = MAX_REVIEW - value.length
  return (
    <>
      <Textarea value={value} maxLength={MAX_REVIEW} {...props} />
      {left <= WARN_LEFT && (
        <span className={cn('self-end text-xs', left === 0 ? 'text-red-600' : 'text-stone-500')}>
          {value.length.toLocaleString('ru-RU')} / {MAX_REVIEW.toLocaleString('ru-RU')}
        </span>
      )}
    </>
  )
}

/** A review is folded to a few lines when it is longer than this. */
const FOLD_CHARS = 500
const FOLD_LINES = 6

/** A review as text; a long one is folded with a «read in full» button. */
export function ReviewText({ text, className }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false)
  const long = text.length > FOLD_CHARS || text.split('\n').length > FOLD_LINES
  return (
    <div className={cn('flex w-full flex-col items-start gap-1', className)}>
      <p className={cn('w-full whitespace-pre-line text-stone-600 dark:text-stone-300', long && !open && 'line-clamp-6')}>{text}</p>
      {long && (
        <button type="button" className="text-xs text-amber-700 hover:underline" onClick={() => setOpen(!open)}>
          {open ? 'Свернуть' : 'Читать полностью'}
        </button>
      )}
    </div>
  )
}
