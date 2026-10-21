import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api } from './client'
import { eventKeys } from './events'
import type {
  ActivityEntry,
  AddPlaySessionRequest,
  EditPlaythroughRequest,
  FinishRequest,
  LeaderboardRow,
  PlaySession,
  PlaySessions,
  PlayerView,
  QueueEntry,
  SpinResult,
} from './types.gen'

export const playKeys = {
  player: (slug: string, id: number) => ['events', slug, 'players', id] as const,
  leaderboard: (slug: string) => ['events', slug, 'leaderboard'] as const,
  queue: (slug: string) => ['events', slug, 'queue'] as const,
  activity: (slug: string) => ['events', slug, 'activity'] as const,
  sessions: (slug: string, id: number) => ['events', slug, 'sessions', id] as const,
}

const base = (slug: string) => `/api/events/${encodeURIComponent(slug)}`

export function usePlayer(slug: string, id: number | undefined) {
  return useQuery({
    queryKey: playKeys.player(slug, id ?? 0),
    queryFn: () => api<PlayerView>(`${base(slug)}/players/${id}`),
    enabled: id !== undefined,
  })
}

export function useLeaderboard(slug: string) {
  return useQuery({ queryKey: playKeys.leaderboard(slug), queryFn: () => api<LeaderboardRow[]>(`${base(slug)}/leaderboard`) })
}

export function useQueue(slug: string, enabled: boolean) {
  return useQuery({ queryKey: playKeys.queue(slug), queryFn: () => api<QueueEntry[]>(`${base(slug)}/queue`), enabled })
}

export function useActivity(slug: string) {
  return useQuery({ queryKey: playKeys.activity(slug), queryFn: () => api<ActivityEntry[]>(`${base(slug)}/activity?limit=50`) })
}

/** After any game action everything about the event may have changed. */
function useRefreshEvent(slug: string) {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: eventKeys.detail(slug) })
}

/** Spinning returns the wheel snapshot and result; the caller animates it and then applies the new view. */
export function useSpin(slug: string) {
  return useMutation({
    mutationFn: (stepId: number) => api<SpinResult>(`${base(slug)}/steps/${stepId}/spin`, { method: 'POST' }),
  })
}

/** Actions that return the acting player's new view. */
function usePlayerAction<V>(slug: string, fn: (v: V) => Promise<PlayerView>) {
  const qc = useQueryClient()
  const refresh = useRefreshEvent(slug)
  return useMutation({
    mutationFn: fn,
    onSuccess: (view) => {
      qc.setQueryData(playKeys.player(slug, view.player.id), view)
      void refresh()
    },
  })
}

export function useChoose(slug: string) {
  return usePlayerAction(slug, ({ stepId, choice }: { stepId: number; choice: number }) =>
    api<PlayerView>(`${base(slug)}/steps/${stepId}/choose`, { method: 'POST', json: { choice } }),
  )
}

export function useFinish(slug: string) {
  return usePlayerAction(slug, ({ stepId, ...req }: FinishRequest & { stepId: number }) =>
    api<PlayerView>(`${base(slug)}/steps/${stepId}/finish`, { method: 'POST', json: req }),
  )
}

export function useUseItem(slug: string) {
  return usePlayerAction(slug, (itemId: number) => api<PlayerView>(`${base(slug)}/items/${itemId}/use`, { method: 'POST' }))
}

/** Actions without a body in the answer; they refresh the event. */
function useEventAction<V>(slug: string, fn: (v: V) => Promise<void>) {
  const refresh = useRefreshEvent(slug)
  return useMutation({ mutationFn: fn, onSuccess: () => refresh() })
}

export function useItemInput(slug: string) {
  return useEventAction(slug, ({ itemId, values }: { itemId: number; values: Record<string, unknown> }) =>
    api<void>(`${base(slug)}/items/${itemId}/input`, { method: 'POST', json: { values } }),
  )
}

export function useConfirmGame(slug: string) {
  return useEventAction(slug, ({ id, accept }: { id: number; accept: boolean }) =>
    api<void>(`${base(slug)}/playthroughs/${id}/confirm`, { method: 'POST', json: { accept } }),
  )
}

export function useConfirmItem(slug: string) {
  return useEventAction(slug, ({ id, accept }: { id: number; accept: boolean }) =>
    api<void>(`${base(slug)}/items/${id}/confirm`, { method: 'POST', json: { accept } }),
  )
}

/** Listens to the event's live stream and refetches whatever is shown. */
export function useEventStream(slug: string) {
  const qc = useQueryClient()
  useEffect(() => {
    if (typeof EventSource === 'undefined') return
    const es = new EventSource(`${base(slug)}/stream`)
    const onChange = () => void qc.invalidateQueries({ queryKey: eventKeys.detail(slug) })
    es.addEventListener('change', onChange)
    return () => {
      es.removeEventListener('change', onChange)
      es.close()
    }
  }, [slug, qc])
}

export function useUndoStep(slug: string) {
  return useEventAction(slug, (playerId: number) => api<void>(`${base(slug)}/players/${playerId}/undo`, { method: 'POST' }))
}

export function useEditPlaythrough(slug: string) {
  return useEventAction(slug, ({ id, ...req }: EditPlaythroughRequest & { id: number }) =>
    api<void>(`${base(slug)}/playthroughs/${id}`, { method: 'PATCH', json: req }),
  )
}

/** Saved play sessions of the game the player is playing now. */
export function usePlaySessions(slug: string, playerId: number) {
  return useQuery({
    queryKey: playKeys.sessions(slug, playerId),
    queryFn: () => api<PlaySessions>(`${base(slug)}/players/${playerId}/sessions`),
  })
}

/** Adding, changing and deleting play sessions; each refreshes the list. */
export function usePlaySessionMutations(slug: string, playerId: number) {
  const qc = useQueryClient()
  const onSuccess = () => qc.invalidateQueries({ queryKey: playKeys.sessions(slug, playerId) })
  return {
    add: useMutation({
      mutationFn: (req: AddPlaySessionRequest) =>
        api<PlaySession>(`${base(slug)}/players/${playerId}/sessions`, { method: 'POST', json: req }),
      onSuccess,
    }),
    update: useMutation({
      mutationFn: ({ id, durationMs }: { id: number; durationMs: number }) =>
        api<PlaySession>(`${base(slug)}/sessions/${id}`, { method: 'PATCH', json: { durationMs } }),
      onSuccess,
    }),
    remove: useMutation({
      mutationFn: (id: number) => api<void>(`${base(slug)}/sessions/${id}`, { method: 'DELETE' }),
      onSuccess,
    }),
  }
}

export function useFinishEvent(slug: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api<void>(`${base(slug)}/finish`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['events'] }),
  })
}

/** The download link of the event's full export (judges only). */
export const exportUrl = (slug: string) => `${base(slug)}/export`
