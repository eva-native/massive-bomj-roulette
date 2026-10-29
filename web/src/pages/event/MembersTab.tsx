import { Link } from 'react-router'
import { useMe } from '@/api/hooks'
import { useRemoveMember, useUpdateMember } from '@/api/events'
import { useLeaderboard } from '@/api/play'
import type { Member } from '@/api/types.gen'
import { Avatar, Badge, ErrorText } from '@/components/ui'
import { playerPath } from '@/lib/paths'
import { useEventContext } from './context'

export function MembersTab() {
  const { event } = useEventContext()
  const { data: me } = useMe()
  const board = useLeaderboard(event.slug)
  const players = new Set(board.data?.map((r) => r.player.id))
  const update = useUpdateMember(event.slug)
  const remove = useRemoveMember(event.slug)
  const isJudge = event.me?.isJudge ?? false

  return (
    <div className="flex flex-col gap-3">
      <ErrorText error={update.error ?? remove.error} />
      <ul className="flex flex-col divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">
        {event.members.map((m) => (
          <li key={m.userId} className="flex flex-wrap items-center justify-between gap-3 p-3">
            <div className="flex items-center gap-3">
              <Avatar name={m.name} url={m.avatarUrl} size="sm" />
              <span className="font-medium">
                {/* Whoever is on the leaderboard has a board: participants,
                    former players with turns, the frozen list of a finished event. */}
                {players.has(m.userId) ? (
                  <Link to={playerPath(event.slug, m.userId)} className="hover:text-link hover:underline">
                    {m.name}
                  </Link>
                ) : (
                  m.name
                )}
                {m.userId === me?.id && <span className="text-muted"> (вы)</span>}
              </span>
              {m.isJudge && <Badge tone="amber">Судья</Badge>}
              {m.isParticipant && <Badge tone="green">Участник</Badge>}
              {!m.isParticipant && !m.isJudge && <Badge>без роли</Badge>}
            </div>
            {isJudge && (
              <RoleControls
                member={m}
                busy={update.isPending || remove.isPending}
                onChange={(req) => update.mutate({ userId: m.userId, ...req })}
                onRemove={() => {
                  if (confirm(`Убрать ${m.name} из ивента?`)) remove.mutate(m.userId)
                }}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function RoleControls({
  member,
  busy,
  onChange,
  onRemove,
}: {
  member: Member
  busy: boolean
  onChange: (req: { isParticipant?: boolean; isJudge?: boolean }) => void
  onRemove: () => void
}) {
  return (
    <div className="flex items-center gap-4 text-sm">
      <label className="flex items-center gap-1">
        <input
          type="checkbox"
          checked={member.isParticipant}
          disabled={busy}
          onChange={(e) => onChange({ isParticipant: e.target.checked })}
        />
        Участник
      </label>
      <label className="flex items-center gap-1">
        <input type="checkbox" checked={member.isJudge} disabled={busy} onChange={(e) => onChange({ isJudge: e.target.checked })} />
        Судья
      </label>
      <button type="button" className="text-danger hover:underline disabled:opacity-50" disabled={busy} onClick={onRemove}>
        Убрать
      </button>
    </div>
  )
}
