import { Link, NavLink, Outlet, useParams } from 'react-router'
import { useEvent, useJoinEvent } from '@/api/events'
import { useMe } from '@/api/hooks'
import { useEventStream } from '@/api/play'
import { Button } from '@/components/Button'
import { buttonClass } from '@/components/buttonClass'
import { Badge, ErrorText, Loading } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { EventContext } from './context'

export function EventLayout() {
  const { slug = '' } = useParams()
  const event = useEvent(slug)
  const join = useJoinEvent(slug)
  const { data: me } = useMe()
  useEventStream(slug)

  if (event.isPending) return <Loading />
  if (event.isError) return <ErrorText error={event.error} />

  const ev = event.data
  const isJudge = ev.me?.isJudge ?? false
  const tabs = [
    { to: '', label: 'Таблица', end: true },
    ...(ev.me?.isParticipant ? [{ to: 'play', label: 'Мой ход' }] : []),
    ...(isJudge ? [{ to: 'judge', label: 'Судья' }] : []),
    { to: 'members', label: 'Участники' },
    { to: 'games', label: 'Игры' },
    { to: 'movies', label: 'Фильмы' },
    { to: 'rules', label: 'Предметы' },
    ...(isJudge ? [{ to: 'settings', label: 'Настройки' }] : []),
  ]

  return (
    <main className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">{ev.title}</h1>
          {ev.status === 'finished' && <Badge>Завершён</Badge>}
          {isJudge && <Badge tone="amber">Судья</Badge>}
          {ev.me?.isParticipant && <Badge tone="green">Участник</Badge>}
        </div>
        {!ev.me?.isParticipant &&
          ev.status === 'active' &&
          (me ? (
            <Button onClick={() => join.mutate()} disabled={join.isPending}>
              Участвовать
            </Button>
          ) : (
            <Link to={`/login?next=/e/${ev.slug}`} className={buttonClass('primary')}>
              Войти, чтобы участвовать
            </Link>
          ))}
      </div>
      <ErrorText error={join.error} />

      <nav className="flex gap-1 overflow-x-auto border-b border-stone-200 dark:border-stone-800">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              cn(
                '-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap',
                isActive ? 'border-amber-500 text-stone-900 dark:text-stone-100' : 'border-transparent text-stone-500 hover:text-stone-800',
              )
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>

      <Outlet context={{ event: ev } satisfies EventContext} />
    </main>
  )
}
