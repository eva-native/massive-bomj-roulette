import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api } from './client'
import { eventKeys } from './events'
import type {
  ActivityEntry,
  EditPlaythroughRequest,
  FinishRequest,
  LeaderboardRow,
  PlayTime,
  PlayTimeRequest,
  PlayerView,
  QueueEntry,
  SpinResult,
} from './types.gen'

export const playKeys = {
  player: (slug: string, id: number) => ['events', slug, 'players', id] as const,
  leaderboard: (slug: string) => ['events', slug, 'leaderboard'] as const,
  queue: (slug: string) => ['events', slug, 'queue'] as const,
  activity: (slug: string) => ['events', slug, 'activity'] as const,
  playTime: (slug: string, id: number) => ['events', slug, 'playtime', id] as const,
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

/**
 * The live stream's state: `reconnecting` once it has been down for a while,
 * `closed` when the browser gave up on it (only a page reload helps then).
 */
export type StreamStatus = 'live' | 'reconnecting' | 'closed'

/** How long the stream may be down before the page says so; a normal reconnect takes about 3 s. */
export const STREAM_DOWN_NOTICE_MS = 3000

/**
 * Listens to the event's live stream and refetches whatever is shown. The
 * server does not replay what happened while the stream was down, so after a
 * reconnect, and when the tab comes back while the stream is still down,
 * everything is fetched again.
 */
export function useEventStream(slug: string): StreamStatus {
  const qc = useQueryClient()
  const [status, setStatus] = useState<StreamStatus>('live')
  useEffect(() => {
    if (typeof EventSource === 'undefined') return
    const es = new EventSource(`${base(slug)}/stream`)
    const refresh = () => void qc.invalidateQueries({ queryKey: eventKeys.detail(slug) })
    let opened = false
    let notice: ReturnType<typeof setTimeout> | undefined
    const onOpen = () => {
      clearTimeout(notice)
      notice = undefined
      setStatus('live')
      if (opened) refresh() // a reconnect: changes made meanwhile never reached us
      opened = true
    }
    const onError = () => {
      if (es.readyState === EventSource.CLOSED) {
        clearTimeout(notice)
        setStatus('closed')
        return
      }
      notice ??= setTimeout(() => setStatus('reconnecting'), STREAM_DOWN_NOTICE_MS)
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible' && es.readyState !== EventSource.OPEN) refresh()
    }
    es.addEventListener('change', refresh)
    es.addEventListener('open', onOpen)
    es.addEventListener('error', onError)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(notice)
      es.removeEventListener('change', refresh)
      es.removeEventListener('open', onOpen)
      es.removeEventListener('error', onError)
      document.removeEventListener('visibilitychange', onVisible)
      es.close()
    }
  }, [slug, qc])
  return status
}

export function useUndoStep(slug: string) {
  return useEventAction(slug, (playerId: number) => api<void>(`${base(slug)}/players/${playerId}/undo`, { method: 'POST' }))
}

export function useEditPlaythrough(slug: string) {
  return useEventAction(slug, ({ id, ...req }: EditPlaythroughRequest & { id: number }) =>
    api<void>(`${base(slug)}/playthroughs/${id}`, { method: 'PATCH', json: req }),
  )
}

/** The time the player saved for the game they are playing now. */
export function usePlayTime(slug: string, playerId: number) {
  return useQuery({
    queryKey: playKeys.playTime(slug, playerId),
    queryFn: () => api<PlayTime>(`${base(slug)}/players/${playerId}/playtime`),
  })
}

/** Adds a timer session to the saved time ({ addMs }) or replaces it ({ setMs }). */
export function useUpdatePlayTime(slug: string, playerId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: Partial<PlayTimeRequest>) =>
      api<PlayTime>(`${base(slug)}/players/${playerId}/playtime`, { method: 'POST', json: { addMs: 0, setMs: null, ...req } }),
    onSuccess: (v) => qc.setQueryData(playKeys.playTime(slug, playerId), v),
  })
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
