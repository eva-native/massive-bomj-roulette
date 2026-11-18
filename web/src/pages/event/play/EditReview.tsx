import { useState, type FormEvent } from 'react'
import { useEditReview } from '@/api/play'
import type { PlaythroughView } from '@/api/types.gen'
import { Button } from '@/components/Button'
import { InlineEdit } from '@/components/InlineEdit'
import { ReviewCounter } from '@/components/Review'
import { ErrorText, Field, Textarea } from '@/components/ui'
import { reviewTooLong } from '@/lib/review'

/** An owner's review editor; scoring and judge confirmation are separate. */
export function EditReview({ slug, pt }: { slug: string; pt: PlaythroughView }) {
  // Playthrough IDs are local to an event; drafts and mutations belong to both.
  return <ReviewEditor key={`${slug}:${pt.id}`} slug={slug} pt={pt} />
}

function ReviewEditor({ slug, pt }: { slug: string; pt: PlaythroughView }) {
  const edit = useEditReview(slug)
  const [open, setOpen] = useState(false)
  const [review, setReview] = useState(pt.review)
  const required = pt.outcome !== 'tech'
  const cancel = () => { if (!edit.isPending) setOpen(false) }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (edit.isPending) return
    edit.mutate({ id: pt.id, review }, { onSuccess: () => setOpen(false) })
  }

  return (
    <InlineEdit active={open} onCancel={cancel}>
      {open ? (
        <form onSubmit={submit} className="flex w-full flex-col gap-2">
          <Field label="Обзор" required={required} after={<ReviewCounter text={review} />}>
            <Textarea required={required} disabled={edit.isPending} value={review} onChange={(e) => setReview(e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" variant="secondary" disabled={edit.isPending || reviewTooLong(review) || (required && !review.trim())}>Сохранить</Button>
            <Button variant="secondary" disabled={edit.isPending} onClick={cancel}>Отмена</Button>
          </div>
          <ErrorText error={edit.error} />
        </form>
      ) : (
        <button data-edit-trigger type="button" className="min-h-6 py-1 text-xs text-link hover:underline" onClick={() => {
          setReview(pt.review)
          edit.reset()
          setOpen(true)
        }}>Редактировать обзор</button>
      )}
    </InlineEdit>
  )
}
