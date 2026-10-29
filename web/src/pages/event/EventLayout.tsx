import { Link, NavLink, Outlet, useParams, useSearchParams } from 'react-router'
import { useEvent, useJoinEvent } from '@/api/events'
import { useMe } from '@/api/hooks'
import { useEventStream } from '@/api/play'
import { Button } from '@/components/Button'
import { buttonClass } from '@/components/buttonClass'
import { Badge, ErrorText, Loading } from '@/components/ui'
import { cn } from '@/lib/cn'
import { RULES_URL } from '@/lib/links'
import type { EventContext } from './context'

/** An inactive tab brightens under the pointer: darker in the light theme, lighter in the dark one. */
const TAB_HOVER = 'hover:text-stone-800 dark:hover:text-stone-200'

export function EventLayout() {
  const { slug = '' } = useParams()
  const event = useEvent(slug)
  const join = useJoinEvent(slug)
  const { data: me } = useMe()
  const [params] = useSearchParams()
  const invite = params.get('invite') ?? ''
  const stream = useEventStream(slug).status

  if (event.isPending) return <Loading />
  if (event.isError) return <ErrorText error={event.error} />

  const ev = event.data
  const isJudge = ev.me?.isJudge ?? false
  // Invite-only events need the code from the link, unless you are already in the list.
  const canJoin = !ev.settings.inviteOnly || invite !== '' || Boolean(me?.isAdmin) || ev.members.some((m) => m.userId === me?.id)
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
            canJoin ? (
              <Button onClick={() => join.mutate(invite)} disabled={join.isPending}>
                Участвовать
              </Button>
            ) : (
              <span className="text-sm text-muted">Вступление по ссылке-приглашению</span>
            )
          ) : (
            <Link to={`/login?next=${encodeURIComponent(`/e/${ev.slug}${invite ? `?invite=${invite}` : ''}`)}`} className={buttonClass('primary')}>
              Войти, чтобы участвовать
            </Link>
          ))}
      </div>
      <ErrorText error={join.error} />
      {ev.status === 'finished' && (
        <p className="rounded-lg bg-stone-100 px-3 py-2 text-sm dark:bg-stone-800">Ивент завершён — итоги заморожены.</p>
      )}
      {/* The live region stays in the page, so screen readers announce the notice when it appears.
          While empty, the negative margin takes back the column's gap. */}
      <div role="status" className="empty:-mt-4">
        {stream !== 'live' && (
          <p className="rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {stream === 'closed'
              ? 'Нет связи с сервером уже больше минуты. Пробуем снова; если не помогает, обновите страницу.'
              : 'Нет связи с сервером, переподключаемся… Пока связи нет, изменения на странице не появляются.'}
          </p>
        )}
      </div>

      {/* Scrolls sideways on narrow screens, never up and down. The bottom line is an inset
          shadow, so the active tab's underline covers it without sticking out of the box. */}
      <nav className="flex gap-1 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_var(--color-stone-200)] dark:shadow-[inset_0_-1px_0_var(--color-stone-800)]">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              cn(
                'border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap',
                isActive ? 'border-amber-500 text-stone-900 dark:text-stone-100' : `border-transparent text-muted ${TAB_HOVER}`,
              )
            }
          >
            {t.label}
          </NavLink>
        ))}
        <a
          href={RULES_URL}
          target="_blank"
          rel="noreferrer"
          className={`border-b-2 border-transparent px-3 py-2 text-sm font-medium whitespace-nowrap text-muted ${TAB_HOVER}`}
        >
          Правила ↗
        </a>
      </nav>

      <Outlet context={{ event: ev } satisfies EventContext} />
    </main>
  )
}
