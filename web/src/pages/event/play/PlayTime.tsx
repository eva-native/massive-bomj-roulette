import { useState } from 'react'
import { useUpdatePlayTime } from '@/api/play'
import type { PlayTime as Saved } from '@/api/types.gen'
import { Button } from '@/components/Button'
import { DurationInput } from '@/components/DurationInput'
import { ErrorText } from '@/components/ui'
import { formatClock, formatHours, hmsToHours, hoursToHMS, type HMS } from '@/lib/hours'
import type { LocalTimer } from '@/lib/localTimer'

const msOf = (hours: number) => Math.round(hours * 3600 * 1000)
const hoursOf = (ms: number) => ms / 3600000

/**
 * Time spent on the game: the running session (kept in this browser) and
 * the saved total (kept on the server, so it adds up across days). `timer`
 * is set for the player; the player and judges may correct the total.
 */
export function PlayTime({ slug, playerId, saved, timer }: { slug: string; playerId: number; saved: Saved; timer: LocalTimer | null }) {
  const update = useUpdatePlayTime(slug, playerId)
  if (!timer && saved.totalMs === 0 && !saved.canEdit) return null
  const total = saved.totalMs + (timer?.ms ?? 0)

  return (
    <section className="flex flex-col gap-3 rounded-lg bg-stone-100 p-3 text-sm dark:bg-stone-800" aria-label="Время в игре">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="font-semibold">Время в игре</h4>
        <span className="text-stone-600 dark:text-stone-300">
          всего <span className="font-semibold">{formatHours(hoursOf(total))}</span>
        </span>
      </div>

      {timer && (
        <CurrentSession
          timer={timer}
          saving={update.isPending}
          onSave={(ms) => update.mutate({ addMs: ms }, { onSuccess: () => timer.reset() })}
        />
      )}

      <SavedTotal saved={saved} pending={update.isPending} onSet={(ms) => update.mutate({ setMs: ms })} />
      <ErrorText error={update.error} />
    </section>
  )
}

function CurrentSession({ timer, saving, onSave }: { timer: LocalTimer; saving: boolean; onSave: (ms: number) => void }) {
  const [editing, setEditing] = useState<HMS | null>(null)
  const edited = editing && hmsToHours(editing)

  if (editing) {
    return (
      <div className="flex flex-wrap items-end gap-2">
        <DurationInput label="Текущая сессия" value={editing} onChange={setEditing} />
        <Button
          variant="secondary"
          disabled={edited === null}
          onClick={() => {
            if (edited === null) return
            timer.set(msOf(edited))
            setEditing(null)
          }}
        >
          Готово
        </Button>
        <Button variant="secondary" onClick={() => setEditing(null)}>
          Отмена
        </Button>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-2xl tabular-nums" role="timer" aria-label="Текущая сессия">
          {formatClock(timer.ms)}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {timer.running ? (
            <Button variant="secondary" onClick={timer.pause}>
              Пауза
            </Button>
          ) : (
            <Button variant="secondary" onClick={timer.start}>
              {timer.ms > 0 ? 'Продолжить' : 'Старт'}
            </Button>
          )}
          <Button
            variant="secondary"
            disabled={saving || timer.ms < 1000}
            onClick={() => {
              timer.pause()
              onSave(Math.round(timer.ms))
            }}
          >
            Сохранить сессию
          </Button>
          <button
            type="button"
            className="text-xs text-amber-700 hover:underline"
            onClick={() => {
              timer.pause()
              setEditing(hoursToHMS(hoursOf(timer.ms)))
            }}
          >
            Изменить
          </button>
        </div>
      </div>
      <p className="text-xs text-stone-500">
        Таймер идёт в этом браузере и не сбросится при перезагрузке. «Сохранить сессию» прибавит время к игре — так оно копится между днями.
      </p>
    </div>
  )
}

/** The saved total with a way to correct it (forgot the timer, left it running). */
function SavedTotal({ saved, pending, onSet }: { saved: Saved; pending: boolean; onSet: (ms: number) => void }) {
  const [editing, setEditing] = useState<HMS | null>(null)
  const edited = editing && hmsToHours(editing)
  if (editing) {
    return (
      <div className="flex flex-wrap items-end gap-2">
        <DurationInput label="Сохранено" value={editing} onChange={setEditing} />
        <Button
          variant="secondary"
          disabled={pending || edited === null}
          onClick={() => {
            if (edited === null) return
            onSet(msOf(edited))
            setEditing(null)
          }}
        >
          Сохранить
        </Button>
        <Button variant="secondary" onClick={() => setEditing(null)}>
          Отмена
        </Button>
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span>
        Сохранено: <span className="font-medium">{formatHours(hoursOf(saved.totalMs))}</span>
      </span>
      {saved.canEdit && (
        <button type="button" className="text-xs text-amber-700 hover:underline" onClick={() => setEditing(hoursToHMS(hoursOf(saved.totalMs)))}>
          Изменить
        </button>
      )}
    </div>
  )
}
