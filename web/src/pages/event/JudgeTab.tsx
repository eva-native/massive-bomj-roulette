import { Navigate } from 'react-router'
import { useQueue } from '@/api/play'
import type { QueueEntry } from '@/api/types.gen'
import { ErrorText, Loading } from '@/components/ui'
import { useEventContext } from './context'
import { JudgeDecision } from './play/JudgeDecision'

export function JudgeTab() {
  const { event } = useEventContext()
  const isJudge = event.me?.isJudge ?? false
  const queue = useQueue(event.slug, isJudge)
  if (!isJudge) return <Navigate to=".." replace />
  if (queue.isPending) return <Loading />
  if (queue.isError) return <ErrorText error={queue.error} />
  if (queue.data.length === 0) return <p className="text-muted">Всё подтверждено, очередь пуста.</p>
  const groups = new Map<number, QueueEntry[]>()
  for (const entry of queue.data) groups.set(entry.player.id, [...(groups.get(entry.player.id) ?? []), entry])
  return <div className="flex flex-col gap-4">{[...groups].map(([id, entries]) => (
    <section key={id} className="flex flex-col gap-2">
      <h2 className="font-semibold">{entries[0]!.player.name} · {entries.length}</h2>
      <ul className="flex flex-col gap-3">{[...entries.filter((e) => e.kind === 'playthrough'), ...entries.filter((e) => e.kind !== 'playthrough')].map((entry) => (
        <li key={`${entry.kind}-${entry.id}`}><JudgeDecision entry={entry} /></li>
      ))}</ul>
    </section>
  ))}</div>
}
