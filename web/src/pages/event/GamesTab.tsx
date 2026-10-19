import { useState, type FormEvent } from 'react'
import { useGameMutations, useGames, useItems } from '@/api/events'
import { useMe } from '@/api/hooks'
import type { Game, GameInput, SpecialGame } from '@/api/types.gen'
import { Button } from '@/components/Button'
import { Badge, Card, ErrorText, Field, Input, Loading, Select } from '@/components/ui'
import { useEventContext } from './context'

const emptyGame: GameInput = { title: '', hltbHours: 0, rating: 0, year: new Date().getFullYear(), specialKey: '' }

export function GamesTab() {
  const { event } = useEventContext()
  const { data: me } = useMe()
  const games = useGames(event.slug)
  const items = useItems(event.slug)
  const { add, update, remove } = useGameMutations(event.slug)
  const [editing, setEditing] = useState<number | null>(null)

  const isJudge = event.me?.isJudge ?? false
  const isMember = Boolean(event.me)
  const canEdit = (g: Game) => isJudge || g.addedBy === me?.id
  const specialGames: SpecialGame[] = items.data?.flatMap((it) => it.specialGames) ?? []

  return (
    <div className="flex flex-col gap-4">
      {isMember && event.status === 'active' && (
        <Card>
          <h2 className="mb-3 font-semibold">Добавить игру</h2>
          <GameForm
            initial={emptyGame}
            specialGames={isJudge ? specialGames : []}
            submitLabel="Добавить"
            pending={add.isPending}
            error={add.error}
            onSubmit={(input, reset) => add.mutate(input, { onSuccess: reset })}
          />
        </Card>
      )}

      {games.isPending && <Loading />}
      <ErrorText error={games.error ?? remove.error} />
      {games.data?.length === 0 && <p className="text-stone-500">В пуле пока нет игр.</p>}

      <ul className="flex flex-col gap-2">
        {games.data?.map((g) =>
          editing === g.id ? (
            <li key={g.id}>
              <Card>
                <GameForm
                  initial={g}
                  specialGames={isJudge ? specialGames : []}
                  submitLabel="Сохранить"
                  pending={update.isPending}
                  error={update.error}
                  onSubmit={(input) => update.mutate({ id: g.id, input }, { onSuccess: () => setEditing(null) })}
                  onCancel={() => setEditing(null)}
                />
              </Card>
            </li>
          ) : (
            <li
              key={g.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-900"
            >
              <div className="flex flex-col gap-0.5">
                <p className="font-medium">
                  {g.title} {g.specialKey && <Badge tone="amber">особая</Badge>}
                </p>
                <p className="text-sm text-stone-500">
                  {g.hltbHours} ч HLTB · рейтинг {g.rating} · {g.year} · добавил {g.addedByName}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-lg font-semibold" title="Базовые очки">
                  {g.basePoints}
                </span>
                {canEdit(g) && event.status === 'active' && (
                  <>
                    <button type="button" className="text-sm text-amber-700 hover:underline" onClick={() => setEditing(g.id)}>
                      Изменить
                    </button>
                    <button
                      type="button"
                      className="text-sm text-red-600 hover:underline"
                      onClick={() => {
                        if (confirm(`Удалить «${g.title}»?`)) remove.mutate(g.id)
                      }}
                    >
                      Удалить
                    </button>
                  </>
                )}
              </div>
            </li>
          ),
        )}
      </ul>
    </div>
  )
}

function GameForm({
  initial,
  specialGames,
  submitLabel,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  initial: GameInput
  specialGames: SpecialGame[]
  submitLabel: string
  pending: boolean
  error: Error | null
  onSubmit: (input: GameInput, reset: () => void) => void
  onCancel?: () => void
}) {
  const [form, setForm] = useState<GameInput>({
    title: initial.title,
    hltbHours: initial.hltbHours,
    rating: initial.rating,
    year: initial.year,
    specialKey: initial.specialKey,
  })
  const set = <K extends keyof GameInput>(key: K, value: GameInput[K]) => setForm((f) => ({ ...f, [key]: value }))
  const num = (v: string) => (v === '' ? 0 : Number(v))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    onSubmit({ ...form, title: form.title.trim() }, () => setForm({ ...emptyGame }))
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Field label="Название" className="col-span-2 sm:col-span-4">
        <Input value={form.title} maxLength={200} onChange={(e) => set('title', e.target.value)} />
      </Field>
      <Field label="Часы HLTB">
        <Input type="number" min={0} max={999} value={form.hltbHours} onChange={(e) => set('hltbHours', num(e.target.value))} />
      </Field>
      <Field label="Рейтинг">
        <Input type="number" min={0} max={100} value={form.rating} onChange={(e) => set('rating', num(e.target.value))} />
      </Field>
      <Field label="Год">
        <Input type="number" min={1950} max={2100} value={form.year} onChange={(e) => set('year', num(e.target.value))} />
      </Field>
      {specialGames.length > 0 && (
        <Field label="Особая игра" hint="Не выпадает на колесе, её подставляет предмет">
          <Select value={form.specialKey} onChange={(e) => set('specialKey', e.target.value)}>
            <option value="">Обычная игра</option>
            {specialGames.map((sg) => (
              <option key={sg.key} value={sg.key}>
                {sg.title}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <div className="col-span-2 flex flex-col gap-2 sm:col-span-4">
        <ErrorText error={error} />
        <div className="flex gap-2">
          <Button type="submit" disabled={!form.title.trim() || pending}>
            {submitLabel}
          </Button>
          {onCancel && (
            <Button variant="secondary" onClick={onCancel}>
              Отмена
            </Button>
          )}
        </div>
      </div>
    </form>
  )
}
