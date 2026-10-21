import { Navigate } from 'react-router'
import { useConfirmGame, useConfirmItem, useQueue } from '@/api/play'
import type { QueueEntry } from '@/api/types.gen'
import { Button } from '@/components/Button'
import { Card, ErrorText, Loading } from '@/components/ui'
import { useEventContext } from './context'
import { ItemCard } from './play/ItemCard'
import { formatHours } from '@/lib/hours'

const outcomeNames: Record<string, string> = { completed: 'прошёл', dropped: 'дропнул', tech: 'просит тех. дроп' }

/** What waits for a judge: finished games and items to confirm or fill in. */
export function JudgeTab() {
  const { event } = useEventContext()
  const isJudge = event.me?.isJudge ?? false
  const queue = useQueue(event.slug, isJudge)

  if (!isJudge) return <Navigate to=".." replace />
  if (queue.isPending) return <Loading />
  if (queue.isError) return <ErrorText error={queue.error} />
  if (queue.data.length === 0) return <p className="text-stone-500">Всё подтверждено, очередь пуста.</p>

  return (
    <ul className="flex flex-col gap-3">
      {queue.data.map((e) => (
        <li key={`${e.kind}-${e.id}`}>
          {e.kind === 'playthrough' ? <GameEntry entry={e} /> : <ItemEntry entry={e} />}
        </li>
      ))}
    </ul>
  )
}

function GameEntry({ entry }: { entry: QueueEntry }) {
  const { event } = useEventContext()
  const confirm = useConfirmGame(event.slug)
  const pt = entry.playthrough!
  return (
    <Card className="flex flex-col gap-2">
      <p>
        <span className="font-medium">{entry.player.name}</span> {outcomeNames[pt.outcome]} «{pt.game}»
        {pt.outcome === 'completed' && ` за ${formatHours(pt.hours)} (HLTB ${pt.hltbHours} ч)`}
      </p>
      {pt.review && <p className="text-sm whitespace-pre-line text-stone-600 dark:text-stone-300">{pt.review}</p>}
      {pt.proof ? (
        <a href={pt.proof} target="_blank" rel="noreferrer" className="text-sm break-all text-amber-700 underline">
          {pt.proof}
        </a>
      ) : (
        <p className="text-sm text-stone-500">Без доказательства</p>
      )}
      <Decision pending={confirm.isPending} onDecide={(accept) => confirm.mutate({ id: entry.id, accept })} />
      <ErrorText error={confirm.error} />
    </Card>
  )
}

function ItemEntry({ entry }: { entry: QueueEntry }) {
  const { event } = useEventContext()
  const confirm = useConfirmItem(event.slug)
  const item = entry.item!
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">
        <span className="font-medium">{entry.player.name}</span>
        {entry.game && <span className="text-stone-500"> · {entry.game}</span>}
      </p>
      <ItemCard slug={event.slug} item={item} members={event.members} editAs="judge" canUse={false} />
      {item.needsConfirm && <Decision pending={confirm.isPending} onDecide={(accept) => confirm.mutate({ id: entry.id, accept })} />}
      <ErrorText error={confirm.error} />
    </div>
  )
}

function Decision({ pending, onDecide }: { pending: boolean; onDecide: (accept: boolean) => void }) {
  return (
    <div className="flex gap-2">
      <Button disabled={pending} onClick={() => onDecide(true)}>
        Подтвердить
      </Button>
      <Button variant="secondary" disabled={pending} onClick={() => onDecide(false)}>
        Отклонить
      </Button>
    </div>
  )
}
