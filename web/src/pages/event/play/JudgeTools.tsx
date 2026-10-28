import { useState, type FormEvent } from 'react'
import { useEditPlaythrough, useUndoStep } from '@/api/play'
import type { PlaythroughView, TurnView } from '@/api/types.gen'
import { Button } from '@/components/Button'
import { DurationInput } from '@/components/DurationInput'
import { ReviewCounter } from '@/components/Review'
import { ErrorText, Input, Textarea } from '@/components/ui'
import { hmsToHours, hoursToHMS, type HMS } from '@/lib/hours'
import { reviewTooLong } from '@/lib/review'

/** A judge's controls for a player's turn: take back the last step. */
export function UndoStep({ slug, playerId, turn }: { slug: string; playerId: number; turn: TurnView }) {
  const undo = useUndoStep(slug)
  const done = turn.steps.some((s) => s.done)
  return (
    <div className="flex flex-col gap-1 border-t border-stone-200 pt-3 dark:border-stone-800">
      <Button
        variant="secondary"
        className="self-start"
        disabled={!done || undo.isPending}
        onClick={() => {
          if (confirm('Отменить последний шаг игрока? Выпавшее на этой крутке тоже отменится.')) undo.mutate(playerId)
        }}
      >
        Судья: отменить последний шаг
      </Button>
      <ErrorText error={undo.error} />
    </div>
  )
}

/** A judge's inline form to correct the time, proof and review of a finished game. */
export function EditPlaythrough({ slug, pt }: { slug: string; pt: PlaythroughView }) {
  const edit = useEditPlaythrough(slug)
  const [open, setOpen] = useState(false)
  const [time, setTime] = useState<HMS>(() => hoursToHMS(pt.hours))
  const [proof, setProof] = useState(pt.proof)
  const [review, setReview] = useState(pt.review)
  const hours = hmsToHours(time)

  if (!open) {
    return (
      <button type="button" className="text-xs text-amber-700 hover:underline" onClick={() => setOpen(true)}>
        Исправить
      </button>
    )
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (hours === null) return
    edit.mutate({ id: pt.id, hours, proof, review }, { onSuccess: () => setOpen(false) })
  }
  return (
    <form onSubmit={submit} className="flex w-full flex-col gap-2">
      <DurationInput label="Время" value={time} onChange={setTime} />
      <Input aria-label="Ссылка" type="url" value={proof} onChange={(e) => setProof(e.target.value)} />
      <Textarea aria-label="Обзор" value={review} onChange={(e) => setReview(e.target.value)} />
      <ReviewCounter text={review} />
      <div className="flex gap-2">
        <Button type="submit" variant="secondary" disabled={edit.isPending || hours === null || reviewTooLong(review)}>
          Сохранить
        </Button>
        <Button variant="secondary" onClick={() => setOpen(false)}>
          Отмена
        </Button>
      </div>
      <ErrorText error={edit.error} />
    </form>
  )
}
