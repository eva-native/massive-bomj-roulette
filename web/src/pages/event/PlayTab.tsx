import { Navigate, useParams } from 'react-router'
import { useMe } from '@/api/hooks'
import { usePlayer } from '@/api/play'
import { ErrorText, Loading } from '@/components/ui'
import { useEventContext } from './context'
import { PlayerBoard } from './play/PlayerBoard'

/** The viewer's own game. */
export function PlayTab() {
  const { event } = useEventContext()
  const { data: me } = useMe()
  if (!event.me?.isParticipant) return <Navigate to=".." replace />
  return <Board slug={event.slug} playerId={me?.id} />
}

/** Anyone's game, read-only unless it is the viewer's. */
export function PlayerPage() {
  const { event } = useEventContext()
  const { userId } = useParams()
  return <Board slug={event.slug} playerId={Number(userId)} />
}

function Board({ slug, playerId }: { slug: string; playerId: number | undefined }) {
  const { event } = useEventContext()
  const view = usePlayer(slug, playerId)
  if (view.isPending) return <Loading />
  if (view.isError) return <ErrorText error={view.error} />
  return <PlayerBoard event={event} view={view.data} />
}
