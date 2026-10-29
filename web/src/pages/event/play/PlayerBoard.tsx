import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useMe } from '@/api/hooks'
import { playKeys, useChoose, useFinish, usePlayTime, useSpin, useUpdatePlayTime } from '@/api/play'
import type { EventDetail, ItemView, PlayerView, PlaythroughView, PlayTime as SavedPlayTime, SpinResult, StepView, TurnView } from '@/api/types.gen'
import { Button } from '@/components/Button'
import { Wheel } from '@/components/Wheel'
import { DurationInput } from '@/components/DurationInput'
import { GameCover } from '@/components/GameCover'
import { ReviewCounter, ReviewText } from '@/components/Review'
import { Badge, Card, ErrorText, Field, Input, Textarea } from '@/components/ui'
import { cn } from '@/lib/cn'
import { emptyHMS, formatHours, hmsToHours, hoursToHMS, type HMS } from '@/lib/hours'
import { blankValue, waitingFirst } from '@/lib/itemState'
import { timerKey, useLocalTimer } from '@/lib/localTimer'
import { reviewTooLong } from '@/lib/review'
import { wheelNames, wheelSeconds } from '@/lib/wheel'
import { ItemCard } from './ItemCard'
import { EditPlaythrough, UndoStep } from './JudgeTools'
import { PlayTime } from './PlayTime'

const stepNames: Record<string, string> = {
  spin_items: 'Колесо эффектов и бонусов',
  spin_drop: 'Колесо дроп-дебаффов',
  choose_player: 'Выбор участника',
  spin_game: 'Колесо игр',
  choose_game: 'Выбор игры',
  spin_movie: 'Киноколесо',
  play: 'Игра',
}

/**
 * The wheel on the board: up to 560 px, the full card width on a phone. The
 * wheel is the centre of a turn, and at this size alphapve's 37 items fit as
 * text. The OBS overlay keeps its own, smaller wheel.
 */
const BOARD_WHEEL = 'max-w-[560px]'

const reasonNames: Record<string, string> = {
  start: 'начало ивента',
  completed: 'после пройденной игры',
  dropped: 'после дропа',
  tech: 'после тех. дропа',
}

/** One player's game: the turn, items, pocket, history and points. */
export function PlayerBoard({ event, view: live }: { event: EventDetail; view: PlayerView }) {
  const qc = useQueryClient()
  const spin = useSpin(event.slug)
  // While the wheel turns we show the spin's snapshot, not the live data,
  // so a refetch in the middle does not cut the animation. The board stays
  // as it was before the spin, so the result shows only once the wheel stops.
  const [spinning, setSpinning] = useState<{ result: SpinResult; done: boolean; before: PlayerView } | null>(null)
  const view = spinning && !spinning.done ? spinning.before : live
  const { data: me } = useMe()
  const turn = view.turn
  const isJudge = event.me?.isJudge ?? false
  // Judges may fill any field; the owner fills player fields; others only look.
  const editAs = isJudge ? 'judge' : me?.id === view.player.id ? 'player' : null

  const doSpin = (stepId: number) => {
    spin.mutate(stepId, { onSuccess: (result) => setSpinning({ result, done: false, before: live }) })
  }
  const finishSpin = () => {
    if (!spinning) return
    setSpinning({ ...spinning, done: true })
    qc.setQueryData(playKeys.player(event.slug, view.player.id), spinning.result.view)
  }

  const onGame = waitingFirst(turn?.items ?? [], editAs, view.canAct)
  const side = onGame.length > 0 || view.pocket.length > 0
  const sharedHint = view.canAct ? sharedPocketHint(view.pocket) : null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xl font-semibold">{view.player.name}</h2>
        <span className="text-2xl font-bold" title="Очки">
          {view.points}
        </span>
      </div>

      {/*
        From 1024 px two columns: on the left what the player does now (the turn, the wheel or
        the game with its timer and form, the history); on the right, sticky, what works on the
        game and the pocket. Narrower, one column in the order game → items on it → wheel or
        form → pocket → history. The column wrappers are `display: contents` there, so their
        blocks take the `order` of a single grid.
      */}
      <div className={cn('grid grid-cols-1 gap-4', side && 'lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start')}>
        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-4">
          {turn && (
            <Card className="order-1 flex flex-col gap-4">
              <h3 className="font-semibold">
                Ход {turn.number} <span className="font-normal text-muted">· {reasonNames[turn.reason]}</span>
              </h3>
              <StepList turn={turn} />
              {turn.playthrough && <GameHeader playthrough={turn.playthrough} />}
            </Card>
          )}

          {turn && (
            // Empty (nothing to do, nothing to show) is hidden, so no blank card stays behind.
            <Card className="order-3 flex flex-col gap-4 empty:hidden">
              {spinning && !spinning.done ? (
                <div className="flex flex-col items-center gap-3">
                  <Wheel
                    sectors={spinning.result.wheel.sectors}
                    target={spinning.result.result}
                    seconds={wheelSeconds(event.settings, spinning.result.wheel.kind)}
                    icons={event.settings.icons}
                    name={wheelNames[spinning.result.wheel.kind]}
                    className={BOARD_WHEEL}
                    onStop={finishSpin}
                  />
                  <p className="text-sm text-muted">Крутится…</p>
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

          <History className="order-5" view={view} judgeSlug={isJudge && event.status === 'active' ? event.slug : null} />
        </div>

        {side && (
          <div className="contents lg:sticky lg:top-4 lg:flex lg:max-h-[calc(100vh-2rem)] lg:min-w-0 lg:flex-col lg:gap-4 lg:overflow-y-auto">
            {onGame.length > 0 && (
              <section className="order-2 flex flex-col gap-2">
                <h3 className="font-semibold">На этой игре</h3>
                {onGame.map((it) => (
                  <ItemCard key={it.id} slug={event.slug} item={it} members={event.members} editAs={editAs} canUse={view.canAct} compact />
                ))}
              </section>
            )}

            {view.pocket.length > 0 && (
              <section className="order-4 flex flex-col gap-2">
                <h3 className="font-semibold">Карман</h3>
                {sharedHint && <p className="text-xs text-muted">Применить бонусы из кармана {sharedHint}</p>}
                {groupPocket(view.pocket).map(({ item, count }) => (
                  <ItemCard
                    key={item.id}
                    slug={event.slug}
                    item={item}
                    members={event.members}
                    editAs={null}
                    canUse={view.canAct}
                    compact
                    count={count}
                    hideHint={sharedHint !== null}
                  />
                ))}
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * The pocket with identical bonuses shown once, «Парашют ×3»: the same item,
 * nothing filled in or noted, the same use state. They are interchangeable,
 * so the card's button uses the first one. Anything else keeps its own card.
 */
function groupPocket(pocket: ItemView[]): { item: ItemView; count: number }[] {
  const groups = new Map<string, { item: ItemView; count: number }>()
  for (const it of pocket) {
    const plain = !it.note && !it.status && it.fields.every((f) => blankValue(f.value))
    const key = plain ? JSON.stringify([it.defId, it.blocked, it.useLabel, it.canUse, it.useHint]) : `item ${it.id}`
    const group = groups.get(key)
    if (group) group.count++
    else groups.set(key, { item: it, count: 1 })
  }
  return [...groups.values()]
}

/**
 * Why nothing in the pocket can be used now, when every usable bonus there is
 * blocked for the same reason (a drop debuff that forbids bonuses): said once
 * above the pocket instead of under each card.
 */
function sharedPocketHint(pocket: ItemView[]): string | null {
  const usable = pocket.filter((it) => it.useLabel)
  const hint = usable[0]?.useHint
  if (usable.length < 2 || !hint || usable.some((it) => it.canUse || it.useHint !== hint)) return null
  return hint
}

/** The game of the turn: cover, title, HLTB hours and base points. */
function GameHeader({ playthrough }: { playthrough: PlaythroughView }) {
  return (
    <div className="flex items-center gap-3">
      <GameCover url={playthrough.coverUrl} title={playthrough.game} size="lg" />
      <div>
        <p className="text-lg font-semibold">{playthrough.game}</p>
        <p className="text-sm text-muted">
          {playthrough.hltbHours} ч HLTB · база {playthrough.basePoints}
        </p>
      </div>
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
              !st.done && !current && 'border-dashed border-stone-300 text-muted dark:border-stone-700',
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
    const spinButton = view.canAct && (
      <Button onClick={() => onSpin(step.id)} disabled={spinPending}>
        {spinPending ? 'Крутим…' : 'Крутить'}
      </Button>
    )
    return (
      <div className="flex flex-col items-center gap-3">
        <p className="font-medium">{stepNames[step.kind]}</p>
        {/* The button goes right under the wheel, before the list of what is on it. */}
        {turn.wheel ? (
          <Wheel
            sectors={turn.wheel.sectors}
            target={null}
            icons={event.settings.icons}
            action={spinButton || undefined}
            name={wheelNames[turn.wheel.kind]}
            className={BOARD_WHEEL}
          />
        ) : (
          spinButton
        )}
      </div>
    )
  }
  if (step.kind === 'choose_player' || step.kind === 'choose_game') {
    return <ChoiceStep slug={event.slug} step={step} canAct={view.canAct} />
  }
  if (step.kind === 'play' && turn.playthrough) {
    return <PlayStep event={event} view={view} playthrough={turn.playthrough} stepId={step.id} />
  }
  return null
}

const nothingSaved: SavedPlayTime = { playthrough: 0, totalMs: 0, canEdit: false }

function PlayStep({ event, view, playthrough, stepId }: { event: EventDetail; view: PlayerView; playthrough: PlaythroughView; stepId: number }) {
  const saved = usePlayTime(event.slug, view.player.id).data ?? nothingSaved
  // The game itself is named above, in the turn's card (GameHeader).
  return view.canAct ? (
    // A new game remounts the timer, so it starts from zero.
    <OwnPlay key={playthrough.id} slug={event.slug} playerId={view.player.id} playthroughId={playthrough.id} stepId={stepId} saved={saved} />
  ) : (
    <PlayTime slug={event.slug} playerId={view.player.id} saved={saved} timer={null} />
  )
}

/** The player's own game: the timer, the sessions and the outcome form. */
function OwnPlay({ slug, playerId, playthroughId, stepId, saved }: { slug: string; playerId: number; playthroughId: number; stepId: number; saved: SavedPlayTime }) {
  const timer = useLocalTimer(timerKey(slug, playthroughId))
  const update = useUpdatePlayTime(slug, playerId)
  // Time still on the timer is saved before the outcome goes to the judge.
  const saveTimer = async () => {
    timer.pause()
    if (timer.ms >= 1000) await update.mutateAsync({ addMs: Math.round(timer.ms) })
    timer.reset()
  }
  return (
    <>
      <PlayTime slug={slug} playerId={playerId} saved={saved} timer={timer} />
      <FinishForm slug={slug} stepId={stepId} timerMs={saved.totalMs + timer.ms} beforeSend={saveTimer} />
    </>
  )
}

function ChoiceStep({ slug, step, canAct }: { slug: string; step: StepView; canAct: boolean }) {
  const choose = useChoose(slug)
  return (
    <div className="flex flex-col gap-2">
      <p className="font-medium">
        {stepNames[step.kind]}
        {step.addedBy && <span className="font-normal text-muted"> · {step.addedBy}</span>}
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

function FinishForm({ slug, stepId, timerMs, beforeSend }: { slug: string; stepId: number; timerMs: number; beforeSend: () => Promise<void> }) {
  const finish = useFinish(slug)
  const [outcome, setOutcome] = useState<'completed' | 'dropped' | 'tech'>('completed')
  const [time, setTime] = useState<HMS>(emptyHMS)
  const [proof, setProof] = useState('')
  const [review, setReview] = useState('')
  const [sending, setSending] = useState(false)
  const hours = hmsToHours(time)
  const reviewRequired = outcome !== 'tech'

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (hours === null) return
    setSending(true)
    try {
      await beforeSend()
      finish.mutate({ stepId, outcome, hours, proof, review })
    } finally {
      setSending(false)
    }
  }

  return (
    // Fields stay about 60 characters wide, an easy line to read and fill, not the card's full width.
    <form onSubmit={submit} className="flex max-w-2xl flex-col gap-3 border-t border-stone-200 pt-3 dark:border-stone-800">
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="radio" name="outcome" checked={outcome === 'completed'} onChange={() => setOutcome('completed')} />
          Прошёл
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="outcome" checked={outcome === 'dropped'} onChange={() => setOutcome('dropped')} />
          Дропнул
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="outcome" checked={outcome === 'tech'} onChange={() => setOutcome('tech')} />
          Тех. дроп
        </label>
      </div>
      {outcome === 'tech' && (
        <p className="text-xs text-muted">
          Игра не запускается или сломана. Без штрафа: судья проверит, игра уйдёт из вашего колеса, а эффекты и дебаффы перейдут на новую игру. Крутится
          только колесо игр. Опишите проблему ссылкой на скриншот или видео.
        </p>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <DurationInput label={outcome === 'completed' ? 'Время в игре' : 'Время в игре (необязательно)'} value={time} onChange={setTime} />
        {timerMs >= 1000 && (
          <Button variant="secondary" onClick={() => setTime(hoursToHMS(timerMs / 3600000))}>
            Взять из таймера: {formatHours(timerMs / 3600000)}
          </Button>
        )}
      </div>
      {hours === null && <p className="text-xs text-danger">Минуты и секунды — от 0 до 59.</p>}
      <Field label="Доказательство (ссылка)">
        <Input type="url" value={proof} onChange={(e) => setProof(e.target.value)} placeholder="https://…" />
      </Field>
      <Field
        label={reviewRequired ? 'Обзор' : 'Обзор (необязательно)'}
        hint="Пара слов об игре: что понравилось, что нет. Увидят все."
        after={<ReviewCounter text={review} />}
      >
        <Textarea value={review} required={reviewRequired} onChange={(e) => setReview(e.target.value)} />
      </Field>
      <ErrorText error={finish.error} />
      <Button type="submit" className="self-start" disabled={sending || finish.isPending || hours === null || (outcome === 'completed' && !hours) || (reviewRequired && !review.trim()) || reviewTooLong(review)}>
        Отправить судье
      </Button>
    </form>
  )
}

const outcomeNames: Record<string, string> = { completed: 'пройдена', dropped: 'дропнута', tech: 'тех. дроп' }

function History({ view, judgeSlug, className }: { view: PlayerView; judgeSlug: string | null; className?: string }) {
  if (view.history.length === 0 && view.entries.length === 0) return null
  return (
    <section className={cn('flex flex-col gap-2', className)}>
      <h3 className="font-semibold">История</h3>
      <ul className="flex flex-col gap-1">
        {view.history.map((pt) => (
          <li key={pt.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-stone-200 px-3 py-2 text-sm dark:border-stone-800">
            <span>
              {pt.game} — {outcomeNames[pt.outcome]}
              {pt.outcome === 'completed' && ` за ${formatHours(pt.hours)}`}
              {!pt.confirmed && <Badge>ждёт судью</Badge>}
            </span>
            <span className="flex items-center gap-3">
              {judgeSlug && <EditPlaythrough slug={judgeSlug} pt={pt} />}
              <span className="font-semibold">{pt.points > 0 ? `+${pt.points}` : pt.points}</span>
            </span>
            {pt.review && <ReviewText text={pt.review} />}
          </li>
        ))}
      </ul>
      {view.entries.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">Откуда очки</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {view.entries.map((e, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span>
                  {e.game}: {e.label}
                  {e.from && <span className="text-muted"> (от {e.from})</span>}
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
