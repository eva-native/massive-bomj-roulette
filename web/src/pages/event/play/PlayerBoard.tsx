import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useMe } from '@/api/hooks'
import { playKeys, useChoose, useFinish, useSpin } from '@/api/play'
import type { EventDetail, PlayerView, SpinResult, StepView, TurnView } from '@/api/types.gen'
import { Button } from '@/components/Button'
import { Wheel } from '@/components/Wheel'
import { Badge, Card, ErrorText, Field, Input } from '@/components/ui'
import { cn } from '@/lib/cn'
import { cleanHoursInput, parseHours } from '@/lib/hours'
import { ItemCard } from './ItemCard'
import { EditPlaythrough, UndoStep } from './JudgeTools'

const stepNames: Record<string, string> = {
  spin_items: 'Колесо эффектов и бонусов',
  spin_drop: 'Колесо дроп-дебаффов',
  choose_player: 'Выбор участника',
  spin_game: 'Колесо игр',
  choose_game: 'Выбор игры',
  spin_movie: 'Киноколесо',
  play: 'Игра',
}

const reasonNames: Record<string, string> = {
  start: 'начало ивента',
  completed: 'после пройденной игры',
  dropped: 'после дропа',
}

/** One player's game: the turn, items, pocket, history and points. */
export function PlayerBoard({ event, view }: { event: EventDetail; view: PlayerView }) {
  const qc = useQueryClient()
  const spin = useSpin(event.slug)
  // While the wheel turns we show the spin's snapshot, not the live data,
  // so a refetch in the middle does not cut the animation.
  const [spinning, setSpinning] = useState<{ result: SpinResult; done: boolean } | null>(null)
  const { data: me } = useMe()
  const turn = view.turn
  const isJudge = event.me?.isJudge ?? false
  // Judges may fill any field; the owner fills player fields; others only look.
  const editAs = isJudge ? 'judge' : me?.id === view.player.id ? 'player' : null

  const doSpin = (stepId: number) => {
    spin.mutate(stepId, { onSuccess: (result) => setSpinning({ result, done: false }) })
  }
  const finishSpin = () => {
    if (!spinning) return
    setSpinning({ ...spinning, done: true })
    qc.setQueryData(playKeys.player(event.slug, view.player.id), spinning.result.view)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xl font-semibold">{view.player.name}</h2>
        <span className="text-2xl font-bold" title="Очки">
          {view.points}
        </span>
      </div>

      {turn && (
        <Card className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">
              Ход {turn.number} <span className="font-normal text-stone-500">· {reasonNames[turn.reason]}</span>
            </h3>
          </div>
          <StepList turn={turn} />

          {spinning && !spinning.done ? (
            <div className="flex flex-col items-center gap-3">
              <Wheel sectors={spinning.result.wheel.sectors} target={spinning.result.result} onStop={finishSpin} />
              <p className="text-sm text-stone-500">Крутится…</p>
            </div>
          ) : (
            <>
              {spinning?.done && (
                <p role="status" className="rounded-lg bg-amber-100 px-3 py-2 text-center font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                  Выпало: {spinning.result.label}
                </p>
              )}
              <CurrentStep
                event={event}
                view={view}
                turn={turn}
                spinPending={spin.isPending}
                onSpin={(id) => {
                  setSpinning(null)
                  doSpin(id)
                }}
              />
            </>
          )}
          <ErrorText error={spin.error} />
          {isJudge && event.status === 'active' && <UndoStep slug={event.slug} playerId={view.player.id} turn={turn} />}
        </Card>
      )}

      {turn && turn.items.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="font-semibold">На этой игре</h3>
          {turn.items.map((it) => (
            <ItemCard
              key={it.id}
              slug={event.slug}
              item={it}
              members={event.members}
              editAs={editAs}
              canUse={view.canAct}
            />
          ))}
        </section>
      )}

      {view.pocket.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="font-semibold">Карман</h3>
          {view.pocket.map((it) => (
            <ItemCard key={it.id} slug={event.slug} item={it} members={event.members} editAs={null} canUse={view.canAct} />
          ))}
        </section>
      )}

      <History view={view} judgeSlug={isJudge && event.status === 'active' ? event.slug : null} />
    </div>
  )
}

function StepList({ turn }: { turn: TurnView }) {
  return (
    <ol className="flex flex-wrap gap-2 text-xs">
      {turn.steps.map((st) => {
        const current = turn.current?.id === st.id
        return (
          <li
            key={st.id}
            className={cn(
              'rounded-full border px-2 py-1',
              st.done && 'border-stone-300 bg-stone-100 text-stone-600 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300',
              current && 'border-amber-500 bg-amber-50 font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200',
              !st.done && !current && 'border-dashed border-stone-300 text-stone-400 dark:border-stone-700',
            )}
            title={st.addedBy ? `Добавлено: ${st.addedBy}` : undefined}
          >
            {stepNames[st.kind] ?? st.kind}
            {st.result && `: ${st.result}`}
          </li>
        )
      })}
    </ol>
  )
}

function CurrentStep({
  event,
  view,
  turn,
  spinPending,
  onSpin,
}: {
  event: EventDetail
  view: PlayerView
  turn: TurnView
  spinPending: boolean
  onSpin: (stepId: number) => void
}) {
  const step = turn.current
  if (turn.waiting) {
    return <p className="rounded-lg bg-stone-100 px-3 py-2 text-center text-sm dark:bg-stone-800">{turn.waiting}</p>
  }
  if (!step) return null

  if (step.kind.startsWith('spin_')) {
    return (
      <div className="flex flex-col items-center gap-3">
        <p className="font-medium">{stepNames[step.kind]}</p>
        {turn.wheel && <Wheel sectors={turn.wheel.sectors} target={null} />}
        {view.canAct && (
          <Button onClick={() => onSpin(step.id)} disabled={spinPending}>
            Крутить
          </Button>
        )}
      </div>
    )
  }
  if (step.kind === 'choose_player' || step.kind === 'choose_game') {
    return <ChoiceStep slug={event.slug} step={step} canAct={view.canAct} />
  }
  if (step.kind === 'play' && turn.playthrough) {
    return (
      <div className="flex flex-col gap-3">
        <div>
          <p className="text-lg font-semibold">{turn.playthrough.game}</p>
          <p className="text-sm text-stone-500">
            {turn.playthrough.hltbHours} ч HLTB · база {turn.playthrough.basePoints}
          </p>
        </div>
        {view.canAct && <FinishForm slug={event.slug} stepId={step.id} />}
      </div>
    )
  }
  return null
}

function ChoiceStep({ slug, step, canAct }: { slug: string; step: StepView; canAct: boolean }) {
  const choose = useChoose(slug)
  return (
    <div className="flex flex-col gap-2">
      <p className="font-medium">
        {stepNames[step.kind]}
        {step.addedBy && <span className="font-normal text-stone-500"> · {step.addedBy}</span>}
      </p>
      <div className="flex flex-wrap gap-2">
        {step.options.map((o) => (
          <Button key={o.id} variant="secondary" disabled={!canAct || choose.isPending} onClick={() => choose.mutate({ stepId: step.id, choice: o.id })}>
            {o.label}
          </Button>
        ))}
      </div>
      <ErrorText error={choose.error} />
    </div>
  )
}

function FinishForm({ slug, stepId }: { slug: string; stepId: number }) {
  const finish = useFinish(slug)
  const [outcome, setOutcome] = useState<'completed' | 'dropped'>('completed')
  const [hours, setHours] = useState('')
  const [proof, setProof] = useState('')
  const parsed = parseHours(hours)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (parsed === null) return
    finish.mutate({ stepId, outcome, hours: parsed, proof })
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 border-t border-stone-200 pt-3 dark:border-stone-800">
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="radio" name="outcome" checked={outcome === 'completed'} onChange={() => setOutcome('completed')} />
          Прошёл
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="outcome" checked={outcome === 'dropped'} onChange={() => setOutcome('dropped')} />
          Дропнул
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Часов в игре">
          <Input inputMode="decimal" value={hours} onChange={(e) => setHours(cleanHoursInput(e.target.value))} placeholder={outcome === 'completed' ? 'например, 25' : 'необязательно'} />
        </Field>
        <Field label="Доказательство (ссылка)">
          <Input type="url" value={proof} onChange={(e) => setProof(e.target.value)} placeholder="https://…" />
        </Field>
      </div>
      <ErrorText error={finish.error} />
      <Button type="submit" className="self-start" disabled={finish.isPending || parsed === null || (outcome === 'completed' && !parsed)}>
        Отправить судье
      </Button>
    </form>
  )
}

const outcomeNames: Record<string, string> = { completed: 'пройдена', dropped: 'дропнута' }

function History({ view, judgeSlug }: { view: PlayerView; judgeSlug: string | null }) {
  if (view.history.length === 0 && view.entries.length === 0) return null
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-semibold">История</h3>
      <ul className="flex flex-col gap-1">
        {view.history.map((pt) => (
          <li key={pt.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-stone-200 px-3 py-2 text-sm dark:border-stone-800">
            <span>
              {pt.game} — {outcomeNames[pt.outcome]}
              {pt.outcome === 'completed' && ` за ${pt.hours} ч`}
              {!pt.confirmed && <Badge>ждёт судью</Badge>}
            </span>
            <span className="flex items-center gap-3">
              {judgeSlug && <EditPlaythrough slug={judgeSlug} pt={pt} />}
              <span className="font-semibold">{pt.points > 0 ? `+${pt.points}` : pt.points}</span>
            </span>
          </li>
        ))}
      </ul>
      {view.entries.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-stone-500">Откуда очки</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {view.entries.map((e, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span>
                  {e.game}: {e.label}
                  {e.from && <span className="text-stone-500"> (от {e.from})</span>}
                </span>
                <span>{e.points > 0 ? `+${e.points}` : e.points}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
