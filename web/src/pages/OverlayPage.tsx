import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { useEvent } from '@/api/events'
import { useActivity, useEventStream, useLeaderboard } from '@/api/play'
import { ItemIcon } from '@/components/ItemIcon'
import { Wheel } from '@/components/Wheel'
import { wheelNames, wheelSeconds } from '@/lib/wheel'

/** How long the result stays on screen after the wheel stops. */
const RESULT_MS = 6000

const shadow = { textShadow: '0 1px 3px rgb(0 0 0 / 0.9)' }

/**
 * The OBS browser source: replays every new spin of the event, and shows the
 * leaderboard and the latest news. Parts can be hidden with ?wheel=0,
 * ?board=0 and ?feed=0.
 */
export function OverlayPage() {
  const { slug = '' } = useParams()
  const [params] = useSearchParams()
  const show = (key: string) => params.get(key) !== '0'
  const { resyncedAt } = useEventStream(slug)
  const activity = useActivity(slug)
  const board = useLeaderboard(slug)
  const event = useEvent(slug) // for the wheel's length

  // Spins that happened before the overlay opened are not replayed.
  const [baseline, setBaseline] = useState<number | null>(null)
  const [stopped, setStopped] = useState<number | null>(null)
  const [hidden, setHidden] = useState<number | null>(null)
  const [resyncSeen, setResyncSeen] = useState(0)
  if (baseline === null && activity.data) {
    setBaseline(activity.data[0]?.id ?? 0)
  }
  // Nor are spins made while the stream was down: once the feed refetched
  // after the reconnect arrives, they would play minutes late.
  if (resyncedAt > resyncSeen && activity.data && activity.dataUpdatedAt >= resyncedAt) {
    setResyncSeen(resyncedAt)
    setBaseline(activity.data[0]?.id ?? 0)
  }

  useEffect(() => {
    document.documentElement.classList.add('overlay')
    return () => document.documentElement.classList.remove('overlay')
  }, [])

  const latest = activity.data?.find((a) => a.spin)
  const current = latest?.spin && baseline !== null && latest.id > baseline && latest.id !== hidden ? latest : null

  return (
    <div className="flex min-h-screen gap-6 p-6 text-white" style={shadow}>
      {show('wheel') && (
        <div className="flex w-[420px] flex-col items-center gap-3">
          {current?.spin && (
            <>
              <p className="text-lg font-semibold">
                {current.spin.player}: {wheelNames[current.spin.wheel.kind] ?? 'колесо'}
              </p>
              <Wheel
                key={current.id}
                sectors={current.spin.wheel.sectors}
                target={current.spin.result}
                legend={false}
                name={wheelNames[current.spin.wheel.kind]}
                seconds={wheelSeconds(event.data?.settings, current.spin.wheel.kind)}
                onStop={() => {
                  setStopped(current.id)
                  setTimeout(() => setHidden(current.id), RESULT_MS)
                }}
              />
              {stopped === current.id && (
                <p className="flex items-center gap-2 rounded-xl bg-black/60 px-4 py-2 text-2xl font-bold">
                  {current.spin.wheel.sectors[current.spin.result]?.defId && (
                    <ItemIcon
                      defId={current.spin.wheel.sectors[current.spin.result]!.defId}
                      kind={current.spin.wheel.sectors[current.spin.result]!.kind}
                      icons={event.data?.settings.icons}
                    />
                  )}
                  {current.spin.label}
                </p>
              )}
            </>
          )}
        </div>
      )}

      <div className="flex flex-1 flex-col gap-6">
        {show('board') && board.data && (
          <ol className="flex w-80 flex-col gap-1 rounded-xl bg-black/50 p-3">
            {board.data.slice(0, 8).map((row, i) => (
              <li key={row.player.id} className="flex items-center justify-between gap-3 text-lg">
                <span>
                  {i + 1}. {row.player.name}
                </span>
                <span className="font-bold">{row.points}</span>
              </li>
            ))}
          </ol>
        )}
        {show('feed') && activity.data && (
          <ul className="flex w-[480px] flex-col gap-1 rounded-xl bg-black/50 p-3 text-base">
            {activity.data.slice(0, 5).map((a) => (
              <li key={a.id}>{a.message}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
