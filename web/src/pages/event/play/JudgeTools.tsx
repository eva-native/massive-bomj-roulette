import { useState, type FormEvent } from 'react'
import { useEditPlaythrough, useUndoStep } from '@/api/play'
import type { PlaythroughView, TurnView } from '@/api/types.gen'
import { Button } from '@/components/Button'
import { ErrorText, Input } from '@/components/ui'
import { cleanHoursInput, parseHours } from '@/lib/hours'

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

/** A judge's inline form to correct hours and proof of a finished game. */
export function EditPlaythrough({ slug, pt }: { slug: string; pt: PlaythroughView }) {
  const edit = useEditPlaythrough(slug)
  const [open, setOpen] = useState(false)
  const [hours, setHours] = useState(String(pt.hours))
  const [proof, setProof] = useState(pt.proof)

  if (!open) {
    return (
      <button type="button" className="text-xs text-amber-700 hover:underline" onClick={() => setOpen(true)}>
        Исправить
      </button>
    )
  }
  const parsed = parseHours(hours)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (parsed === null) return
    edit.mutate({ id: pt.id, hours: parsed, proof }, { onSuccess: () => setOpen(false) })
  }
  return (
    <form onSubmit={submit} className="flex w-full flex-wrap items-center gap-2">
      <Input aria-label="Часы" inputMode="decimal" className="w-24" value={hours} onChange={(e) => setHours(cleanHoursInput(e.target.value))} />
      <Input aria-label="Ссылка" type="url" className="min-w-40 flex-1" value={proof} onChange={(e) => setProof(e.target.value)} />
      <Button type="submit" variant="secondary" disabled={edit.isPending || parsed === null}>
        Сохранить
      </Button>
      <Button variant="secondary" onClick={() => setOpen(false)}>
        Отмена
      </Button>
      <ErrorText error={edit.error} />
    </form>
  )
}
