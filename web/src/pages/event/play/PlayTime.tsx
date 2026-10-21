import { useState } from 'react'
import { usePlaySessionMutations } from '@/api/play'
import type { PlaySession, PlaySessions } from '@/api/types.gen'
import { Button } from '@/components/Button'
import { DurationInput } from '@/components/DurationInput'
import { ErrorText } from '@/components/ui'
import { formatClock, formatHours, hmsToHours, hoursToHMS, emptyHMS, type HMS } from '@/lib/hours'
import type { LocalTimer } from '@/lib/localTimer'

const dateFormat = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const msOf = (hours: number) => Math.round(hours * 3600 * 1000)

/**
 * Time spent on the game: the running session (kept in this browser) and
 * the saved sessions (kept on the server, so the time adds up across days).
 * `timer` is set for the player; judges and the player may edit sessions.
 */
export function PlayTime({ slug, playerId, sessions, timer }: { slug: string; playerId: number; sessions: PlaySessions; timer: LocalTimer | null }) {
  const { add, update, remove } = usePlaySessionMutations(slug, playerId)
  const total = sessions.totalMs + (timer?.ms ?? 0)
  const error = add.error ?? update.error ?? remove.error
  if (!timer && sessions.sessions.length === 0 && !sessions.canEdit) return null

  return (
    <section className="flex flex-col gap-3 rounded-lg bg-stone-100 p-3 text-sm dark:bg-stone-800" aria-label="Время в игре">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="font-semibold">Время в игре</h4>
        <span className="text-stone-600 dark:text-stone-300">
          всего <span className="font-semibold">{formatHours(total / 3600000)}</span>
        </span>
      </div>

      {timer && (
        <CurrentSession
          timer={timer}
          saving={add.isPending}
          onSave={() => add.mutate({ startedAt: '', durationMs: Math.round(timer.ms) }, { onSuccess: () => timer.reset() })}
        />
      )}

      {sessions.sessions.length > 0 && (
        <ul className="flex flex-col gap-1">
          {sessions.sessions.map((s, i) => (
            <SessionRow
              key={s.id}
              n={i + 1}
              session={s}
              canEdit={sessions.canEdit}
              pending={update.isPending || remove.isPending}
              onChange={(durationMs) => update.mutate({ id: s.id, durationMs })}
              onDelete={() => {
                if (confirm(`Удалить сессию ${formatHours(s.durationMs / 3600000)}?`)) remove.mutate(s.id)
              }}
            />
          ))}
        </ul>
      )}

      {sessions.canEdit && <AddByHand pending={add.isPending} onAdd={(durationMs) => add.mutate({ startedAt: '', durationMs })} />}
      <ErrorText error={error} />
    </section>
  )
}

function CurrentSession({ timer, saving, onSave }: { timer: LocalTimer; saving: boolean; onSave: () => void }) {
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
        <div className="flex flex-wrap gap-2">
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
              onSave()
            }}
          >
            Сохранить сессию
          </Button>
          <button
            type="button"
            className="text-xs text-amber-700 hover:underline"
            onClick={() => {
              timer.pause()
              setEditing(hoursToHMS(timer.ms / 3600000))
            }}
          >
            Изменить
          </button>
        </div>
      </div>
      <p className="text-xs text-stone-500">
        Таймер идёт в этом браузере и не сбросится при перезагрузке. «Сохранить сессию» добавит время к игре — так оно копится между днями.
      </p>
    </div>
  )
}

function SessionRow({
  n,
  session,
  canEdit,
  pending,
  onChange,
  onDelete,
}: {
  n: number
  session: PlaySession
  canEdit: boolean
  pending: boolean
  onChange: (ms: number) => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState<HMS | null>(null)
  const edited = editing && hmsToHours(editing)
  if (editing) {
    return (
      <li className="flex flex-wrap items-end gap-2">
        <DurationInput label={`Сессия ${n}`} value={editing} onChange={setEditing} />
        <Button
          variant="secondary"
          disabled={pending || !edited}
          onClick={() => {
            if (!edited) return
            onChange(msOf(edited))
            setEditing(null)
          }}
        >
          Сохранить
        </Button>
        <Button variant="secondary" onClick={() => setEditing(null)}>
          Отмена
        </Button>
      </li>
    )
  }
  return (
    <li className="flex flex-wrap items-center justify-between gap-2">
      <span>
        <span className="text-stone-500">{dateFormat.format(new Date(session.startedAt))}</span> — {formatHours(session.durationMs / 3600000)}
      </span>
      {canEdit && (
        <span className="flex gap-3 text-xs">
          <button type="button" className="text-amber-700 hover:underline" onClick={() => setEditing(hoursToHMS(session.durationMs / 3600000))}>
            Изменить
          </button>
          <button type="button" className="text-red-600 hover:underline disabled:opacity-50" disabled={pending} onClick={onDelete}>
            Удалить
          </button>
        </span>
      )}
    </li>
  )
}

/** For time played without the timer. */
function AddByHand({ pending, onAdd }: { pending: boolean; onAdd: (ms: number) => void }) {
  const [value, setValue] = useState<HMS | null>(null)
  const hours = value && hmsToHours(value)
  if (!value) {
    return (
      <button type="button" className="self-start text-xs text-amber-700 hover:underline" onClick={() => setValue(emptyHMS)}>
        + Добавить время вручную
      </button>
    )
  }
  return (
    <div className="flex flex-wrap items-end gap-2">
      <DurationInput label="Сыграно без таймера" value={value} onChange={setValue} />
      <Button
        variant="secondary"
        disabled={pending || !hours}
        onClick={() => {
          if (!hours) return
          onAdd(msOf(hours))
          setValue(null)
        }}
      >
        Добавить
      </Button>
      <Button variant="secondary" onClick={() => setValue(null)}>
        Отмена
      </Button>
    </div>
  )
}
