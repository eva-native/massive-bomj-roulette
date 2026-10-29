import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { useCreateEvent, useEvents } from '@/api/events'
import { useMe } from '@/api/hooks'
import { Button } from '@/components/Button'
import { Badge, Card, ErrorText, Field, Input, Loading } from '@/components/ui'
import { slugify } from '@/lib/slug'

export function EventsPage() {
  const { data: me } = useMe()
  const events = useEvents()

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Ивенты</h1>

      {events.isPending && <Loading />}
      <ErrorText error={events.error} />
      {events.data?.length === 0 && <p className="text-muted">Ивентов пока нет.</p>}

      <ul className="flex flex-col gap-3">
        {events.data?.map((ev) => (
          <li key={ev.slug}>
            <Link
              to={`/e/${ev.slug}`}
              className="flex items-center justify-between gap-4 rounded-xl border border-stone-200 bg-white p-4 hover:border-amber-400 dark:border-stone-800 dark:bg-stone-900"
            >
              <div>
                <p className="font-medium">{ev.title}</p>
                <p className="text-sm text-muted">Участников: {ev.participants}</p>
              </div>
              <div className="flex gap-2">
                {ev.status === 'finished' && <Badge>Завершён</Badge>}
                {ev.isJudge && <Badge tone="amber">Судья</Badge>}
                {ev.isParticipant && <Badge tone="green">Участник</Badge>}
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {me?.isAdmin && <CreateEventForm />}
    </main>
  )
}

function CreateEventForm() {
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const create = useCreateEvent()
  const navigate = useNavigate()

  const submit = (e: FormEvent) => {
    e.preventDefault()
    create.mutate({ title, slug }, { onSuccess: (ev) => navigate(`/e/${ev.slug}`) })
  }

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <h2 className="font-semibold">Новый ивент</h2>
        <Field label="Название">
          <Input
            value={title}
            maxLength={100}
            onChange={(e) => {
              setTitle(e.target.value)
              if (!slugEdited) setSlug(slugify(e.target.value))
            }}
          />
        </Field>
        <Field label="Адрес" hint={`Ссылка на ивент: /e/${slug || '…'}`}>
          <Input
            value={slug}
            maxLength={40}
            onChange={(e) => {
              setSlugEdited(true)
              setSlug(e.target.value)
            }}
          />
        </Field>
        <ErrorText error={create.error} />
        <Button type="submit" disabled={!title.trim() || !slug || create.isPending} className="self-start">
          Создать
        </Button>
      </form>
    </Card>
  )
}
