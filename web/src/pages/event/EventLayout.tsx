import { useEffect } from 'react'
import { Link, Outlet, useLocation, useMatch, useNavigate, useParams, useSearchParams } from 'react-router'
import { useEvent, useJoinEvent } from '@/api/events'
import { useMe } from '@/api/hooks'
import { useEventStream, usePlayer, useQueue } from '@/api/play'
import { Button } from '@/components/Button'
import { buttonClass } from '@/components/buttonClass'
import { Badge, ErrorText, Loading } from '@/components/ui'
import { RULES_URL } from '@/lib/links'
import { timerKey, useTimerRunning } from '@/lib/localTimer'
import { EventTabs } from './EventTabs'
import type { EventContext } from './context'

const pageLabels: Record<string, string> = {
  '': 'Таблица', play: 'Мой ход', judge: 'Судья', members: 'Участники',
  games: 'Игры', movies: 'Фильмы', rules: 'Предметы', settings: 'Настройки',
}

export function EventLayout() {
  const { slug = '' } = useParams()
  const event = useEvent(slug)
  const join = useJoinEvent(slug)
  const navigate = useNavigate()
  const { data: me } = useMe()
  const [params] = useSearchParams()
  const invite = params.get('invite') ?? ''
  const stream = useEventStream(slug).status

  const queue = useQueue(slug, event.data?.me?.isJudge ?? false)
  const own = usePlayer(slug, event.data?.me?.isParticipant ? me?.id : undefined)
  const playing = own.data?.turn?.playthrough
  const running = useTimerRunning(playing && !playing.outcome && event.data?.status === 'active' ? timerKey(slug, playing.id) : undefined)
  const waits = event.data?.status === 'active' && own.data?.canAct === true
  const base = `/e/${encodeURIComponent(slug)}`
  const location = useLocation()
  const board = useMatch('/e/:slug/players/:id')
  const active = board
    ? (Number(board.params.id) === me?.id && event.data?.me?.isParticipant ? 'play' : '')
    : location.pathname.slice(base.length).replace(/^\/|\/$/g, '')
  const pageName = board
    ? event.data?.members.find((m) => m.userId === Number(board.params.id))?.name ?? 'Доска игрока'
    : pageLabels[active] ?? 'Ивент'
  const title = `${pageName}${active === 'judge' && queue.data?.length ? ` (${queue.data.length})` : ''} · ${event.data?.title ?? slug} · MBR`
  useEffect(() => {
    const previous = document.title
    document.title = title
    return () => { document.title = previous }
  }, [title])

  if (event.isPending) return <Loading />
  if (event.isError) return <ErrorText error={event.error} />

  const ev = event.data
  const isJudge = ev.me?.isJudge ?? false
  // Invite-only events need the code from the link, unless you are already in the list.
  const canJoin = !ev.settings.inviteOnly || invite !== '' || Boolean(me?.isAdmin) || ev.members.some((m) => m.userId === me?.id)
  const tabs = [
    { to: '', label: 'Таблица' },
    ...(ev.me?.isParticipant ? [{
      to: 'play', label: 'Мой ход',
      accessibleLabel: running ? 'Мой ход — таймер идёт' : waits ? 'Мой ход — ждёт вас' : undefined,
      mark: running ? 'timer' as const : waits ? 'action' as const : undefined,
    }] : []),
    ...(isJudge ? [{ to: 'judge', label: `Судья${queue.data?.length ? ` (${queue.data.length})` : ''}` }] : []),
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
          <a href={RULES_URL} target="_blank" rel="noreferrer" className="text-sm text-link underline">
            Правила ивента ↗
          </a>
          {ev.status === 'finished' && <Badge>Завершён</Badge>}
          {isJudge && <Badge tone="amber">Судья</Badge>}
          {ev.me?.isParticipant && <Badge tone="green">Участник</Badge>}
        </div>
        {!ev.me?.isParticipant &&
          ev.status === 'active' &&
          (me ? (
            canJoin ? (
              <Button onClick={() => join.mutate(invite, { onSuccess: () => navigate(`/e/${encodeURIComponent(slug)}/play`) })} disabled={join.isPending}>
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

      <EventTabs base={base} tabs={tabs} active={active} />

      <Outlet context={{ event: ev } satisfies EventContext} />
    </main>
  )
}
