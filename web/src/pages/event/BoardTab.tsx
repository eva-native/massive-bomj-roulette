import { Link } from 'react-router'
import { useActivity, useLeaderboard } from '@/api/play'
import { Avatar, Card, ErrorText, Loading } from '@/components/ui'
import { playerPath } from '@/lib/paths'
import { useEventContext } from './context'

const timeFormat = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** The leaderboard and the live feed. */
export function BoardTab() {
  const { event } = useEventContext()
  const board = useLeaderboard(event.slug)
  const activity = useActivity(event.slug)
  const rows = board.data ?? []
  // Everyone tied for first gets a trophy, unless nobody is ahead yet.
  const top = rows[0]?.points
  const leaders = rows.filter((r) => r.points === top).length
  const hasLeader = rows.length > 0 && (leaders < rows.length || top !== 0)

  return (
    <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
      <Card>
        <h2 className="mb-3 font-semibold">Таблица</h2>
        {board.isPending && <Loading />}
        <ErrorText error={board.error} />
        {board.data?.length === 0 && <p className="text-sm text-stone-500">Пока никто не играет.</p>}
        <ol className="flex flex-col divide-y divide-stone-200 dark:divide-stone-800">
          {board.data?.map((row, i) => (
            <li key={row.player.id}>
              <Link to={playerPath(event.slug, row.player.id)} className="flex items-center gap-3 py-2 hover:text-amber-700">
                <span className="w-6 text-right font-semibold text-stone-500">{i + 1}</span>
                <Avatar name={row.player.name} url={row.player.avatarUrl} size="sm" />
                <span className="flex-1">
                  <span className="font-medium">{row.player.name}</span>
                  {hasLeader && row.points === top && (
                    <span className="ml-1" role="img" aria-label="Лидер" title="Лидер">
                      🏆
                    </span>
                  )}
                  <span className="block text-xs text-stone-500">
                    пройдено {row.completed} · дропнуто {row.dropped}
                    {row.playing && ` · играет в «${row.playing}»`}
                  </span>
                </span>
                <span className="text-lg font-bold">{row.points}</span>
              </Link>
            </li>
          ))}
        </ol>
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold">Лента</h2>
        {activity.isPending && <Loading />}
        <ErrorText error={activity.error} />
        {activity.data?.length === 0 && <p className="text-sm text-stone-500">Пока ничего не произошло.</p>}
        {/* The feed scrolls inside its own box, so a long feed does not stretch the page. */}
        <ul
          aria-label="Лента событий"
          tabIndex={0}
          className="flex max-h-80 flex-col gap-2 overflow-y-auto overscroll-contain pr-2 text-sm lg:max-h-[32rem]"
        >
          {activity.data?.map((a) => (
            <li key={a.id}>
              <span className="text-xs text-stone-500">{timeFormat.format(new Date(a.createdAt))}</span>
              <p>{a.message}</p>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
