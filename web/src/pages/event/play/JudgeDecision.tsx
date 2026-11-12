import { useState } from 'react'
import { Link } from 'react-router'
import { useConfirmGame, useConfirmItem } from '@/api/play'
import type { QueueEntry } from '@/api/types.gen'
import { Button } from '@/components/Button'
import { ReviewText } from '@/components/Review'
import { Avatar, Badge, Card, ErrorText, Field, Textarea } from '@/components/ui'
import { formatHours } from '@/lib/hours'
import { useEventContext } from '../context'
import { ItemCard } from './ItemCard'

const outcomeNames: Record<string, string> = { completed: 'прошёл', dropped: 'дропнул', tech: 'просит тех. дроп' }

export function JudgeDecision({ entry }: { entry: QueueEntry }) {
  const { event } = useEventContext()
  // Drafts, errors and item edits belong to one decision, including across cached routes.
  return <JudgeDecisionForm key={`${event.slug}:${entry.kind}:${entry.id}`} entry={entry} />
}

function JudgeDecisionForm({ entry }: { entry: QueueEntry }) {
  const { event } = useEventContext()
  const game = useConfirmGame(event.slug)
  const item = useConfirmItem(event.slug)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const decide = async (accept: boolean, save?: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      if (accept) await save?.()
      await (entry.kind === 'playthrough' ? game : item).mutateAsync({ id: entry.id, accept, ...(!accept && reason.trim() ? { reason: reason.trim() } : {}) })
      setRejecting(false)
      setReason('')
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      setBusy(false)
    }
  }
  const actions = (save?: () => Promise<void>) => (
    <div className="flex flex-col gap-2">
      {rejecting ? (
        <>
          <Field label="Причина отклонения" hint="Необязательно, до 500 символов">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || [...reason.trim()].length > 500} onClick={() => void decide(false)}>Отклонить</Button>
            <Button variant="secondary" disabled={busy} onClick={() => setRejecting(false)}>Отмена</Button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void decide(true, save)}>{busy ? 'Отправка…' : 'Подтвердить'}</Button>
          <Button variant="secondary" disabled={busy} onClick={() => setRejecting(true)}>Отклонить…</Button>
        </div>
      )}
      <ErrorText error={error} />
    </div>
  )
  const pt = entry.playthrough
  const timer = pt ? pt.timerMs / 3600000 : 0
  const difference = pt ? Math.abs(pt.hours - timer) : 0
  return (
    <Card className="flex flex-col gap-3">
      <header className="flex items-center gap-2">
        <Avatar name={entry.player.name} url={entry.player.avatarUrl} size="sm" />
        <Link to={`/e/${event.slug}/players/${entry.player.id}`} className="font-medium text-link hover:underline">{entry.player.name}</Link>
        <span className="text-sm text-muted">{entry.kind === 'playthrough' ? 'Итог игры' : 'Предмет'}{entry.game && ` · ${entry.game}`}</span>
      </header>
      {pt ? (
        <>
          <p>{outcomeNames[pt.outcome]} «{pt.game}»{pt.outcome === 'completed' && ` за ${formatHours(pt.hours)}`}</p>
          <p className="text-sm">Заявлено {formatHours(pt.hours)} · Таймер {timer > 0 ? formatHours(timer) : 'нет сохранённого времени'}
            {timer > 0 && <> · <span className={pt.hours > 0 && difference / pt.hours > 0.15 ? 'font-medium text-danger' : ''}>разница {formatHours(difference)}</span></>}
          </p>
          <p className="text-sm text-muted">HLTB {pt.hltbHours} ч</p>
          {pt.proof ? <a href={pt.proof} target="_blank" rel="noreferrer" className="text-sm break-all text-link underline">{pt.proof}</a> : <div><Badge tone="amber">Доказательства нет</Badge></div>}
          {pt.review && <div><p className="text-sm font-medium">Обзор</p><ReviewText text={pt.review} className="text-sm" /></div>}
          {actions()}
        </>
      ) : entry.item && (
        <fieldset disabled={busy} className="min-w-0">
          <ItemCard slug={event.slug} item={entry.item} members={event.members} editAs="judge" canUse={false} decision={entry.item.needsConfirm ? actions : undefined} />
        </fieldset>
      )}
    </Card>
  )
}
