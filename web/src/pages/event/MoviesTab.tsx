import { useState, type FormEvent } from 'react'
import { useMovieMutations, useMovies } from '@/api/events'
import { useMe } from '@/api/hooks'
import type { Movie } from '@/api/types.gen'
import { Button } from '@/components/Button'
import { Card, ErrorText, Input, Loading } from '@/components/ui'
import { useEventContext } from './context'

export function MoviesTab() {
  const { event } = useEventContext()
  const { data: me } = useMe()
  const movies = useMovies(event.slug)
  const { add, update, remove } = useMovieMutations(event.slug)
  const [title, setTitle] = useState('')
  const [editing, setEditing] = useState<{ id: number; title: string } | null>(null)

  const isJudge = event.me?.isJudge ?? false
  const active = event.status === 'active'
  const canEdit = (m: Movie) => active && (isJudge || m.addedBy === me?.id)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    add.mutate({ title: title.trim() }, { onSuccess: () => setTitle('') })
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-stone-500">Киноколесо крутится по эффекту «Бабина». Просмотренный фильм больше не выпадает тому, кто его посмотрел.</p>

      {event.me && active && (
        <Card>
          <form onSubmit={submit} className="flex gap-2">
            <Input value={title} maxLength={200} placeholder="Название фильма" aria-label="Название фильма" onChange={(e) => setTitle(e.target.value)} />
            <Button type="submit" disabled={!title.trim() || add.isPending}>
              Добавить
            </Button>
          </form>
          <div className="mt-2">
            <ErrorText error={add.error} />
          </div>
        </Card>
      )}

      {movies.isPending && <Loading />}
      <ErrorText error={movies.error ?? update.error ?? remove.error} />
      {movies.data?.length === 0 && <p className="text-stone-500">Фильмов пока нет.</p>}

      <ul className="flex flex-col gap-2">
        {movies.data?.map((m) => (
          <li
            key={m.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-900"
          >
            {editing?.id === m.id ? (
              <form
                className="flex w-full gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  update.mutate({ id: m.id, input: { title: editing.title.trim() } }, { onSuccess: () => setEditing(null) })
                }}
              >
                <Input value={editing.title} maxLength={200} aria-label="Название фильма" onChange={(e) => setEditing({ id: m.id, title: e.target.value })} />
                <Button type="submit" disabled={!editing.title.trim() || update.isPending}>
                  Сохранить
                </Button>
                <Button variant="secondary" onClick={() => setEditing(null)}>
                  Отмена
                </Button>
              </form>
            ) : (
              <>
                <div>
                  <p className="font-medium">{m.title}</p>
                  <p className="text-sm text-stone-500">добавил {m.addedByName}</p>
                </div>
                {canEdit(m) && (
                  <div className="flex gap-3">
                    <button type="button" className="text-sm text-amber-700 hover:underline" onClick={() => setEditing({ id: m.id, title: m.title })}>
                      Изменить
                    </button>
                    <button
                      type="button"
                      className="text-sm text-red-600 hover:underline"
                      onClick={() => {
                        if (confirm(`Удалить «${m.title}»?`)) remove.mutate(m.id)
                      }}
                    >
                      Удалить
                    </button>
                  </div>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
