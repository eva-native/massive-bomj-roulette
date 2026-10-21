import { useEffect, useState } from 'react'
import { useTimer } from '@/api/play'
import type { TimerView } from '@/api/types.gen'
import { Button } from '@/components/Button'
import { DurationInput } from '@/components/DurationInput'
import { ErrorText } from '@/components/ui'
import { emptyHMS, formatClock, hmsToHours, type HMS } from '@/lib/hours'

/**
 * The stopwatch of the game being played. The server keeps it, so a pause
 * survives reloads; here it only ticks. «Стоп» pauses it and hands the time
 * to the outcome form.
 */
export function Timer({
  slug,
  playerId,
  timer,
  canRun,
  canSet,
  onStop,
}: {
  slug: string
  playerId: number
  timer: TimerView
  canRun: boolean
  canSet: boolean
  onStop: (ms: number) => void
}) {
  // A new server value remounts the clock, so it counts from that moment.
  return <Clock key={`${timer.elapsedMs}:${timer.running}`} {...{ slug, playerId, timer, canRun, canSet, onStop }} />
}

function Clock({ slug, playerId, timer, canRun, canSet, onStop }: Parameters<typeof Timer>[0]) {
  const action = useTimer(slug, playerId)
  const [since] = useState(() => Date.now())
  const [now, setNow] = useState(since)
  useEffect(() => {
    if (!timer.running) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [timer.running])
  const ms = timer.elapsedMs + (timer.running ? now - since : 0)

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-stone-100 p-3 dark:bg-stone-800">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-2xl tabular-nums" role="timer" aria-label="Таймер">
          {formatClock(ms)}
        </span>
        {canRun && (
          <div className="flex gap-2">
            {timer.running ? (
              <Button variant="secondary" disabled={action.isPending} onClick={() => action.mutate({ action: 'pause', ms: 0 })}>
                Пауза
              </Button>
            ) : (
              <Button variant="secondary" disabled={action.isPending} onClick={() => action.mutate({ action: 'start', ms: 0 })}>
                {ms > 0 ? 'Продолжить' : 'Старт'}
              </Button>
            )}
            <Button
              variant="secondary"
              disabled={action.isPending}
              onClick={() => {
                onStop(ms)
                if (timer.running) action.mutate({ action: 'pause', ms: 0 })
              }}
            >
              Стоп
            </Button>
          </div>
        )}
      </div>
      {canRun && <p className="text-xs text-stone-500">«Стоп» ставит таймер на паузу и переносит время в итог игры.</p>}
      {canSet && <SetTimer pending={action.isPending} onSet={(value) => action.mutate({ action: 'set', ms: value })} />}
      <ErrorText error={action.error} />
    </div>
  )
}

function SetTimer({ pending, onSet }: { pending: boolean; onSet: (ms: number) => void }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState<HMS>(emptyHMS)
  const hours = hmsToHours(value)
  if (!open) {
    return (
      <button type="button" className="self-start text-xs text-amber-700 hover:underline" onClick={() => setOpen(true)}>
        Судья: исправить таймер
      </button>
    )
  }
  return (
    <div className="flex flex-wrap items-end gap-2">
      <DurationInput label="Таймер" value={value} onChange={setValue} />
      <Button
        variant="secondary"
        disabled={pending || hours === null}
        onClick={() => {
          if (hours === null) return
          onSet(Math.round(hours * 3600 * 1000))
          setOpen(false)
        }}
      >
        Поставить
      </Button>
    </div>
  )
}
