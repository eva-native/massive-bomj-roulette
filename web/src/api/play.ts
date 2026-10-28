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
 * `closed` when reopening it keeps failing (a page reload may help then).
 */
export type StreamStatus = 'live' | 'reconnecting' | 'closed'

export type EventStream = {
  status: StreamStatus
  /** When the page last refetched after the stream came back (Date.now()), 0 if never. */
  resyncedAt: number
}

/**
 * How long the stream may be down before the page says so. The server tells
 * the browser to retry after 3 s (`retry: 3000`), so a normal reconnect takes
 * a bit longer than that and must not flash the notice.
 */
export const STREAM_DOWN_NOTICE_MS = 8000

/** Reopening a stream the browser gave up on: the first wait, the longest wait, and after how many failures to ask for a reload. */
export const STREAM_REOPEN_FIRST_MS = 3000
const STREAM_REOPEN_MAX_MS = 60_000
export const STREAM_REOPEN_NOTICE_AFTER = 5

/**
 * Listens to the event's live stream and refetches whatever is shown. The
 * server does not replay messages sent while the stream was down, so when it
 * opens after any failure, everything is fetched again. Nothing is fetched
 * while it is down: the server is likely unreachable then, and a failed fetch
 * would replace the page with an error.
 */
export function useEventStream(slug: string): EventStream {
  const qc = useQueryClient()
  // Keyed by slug: another event starts from a clean state, not with this one's notice.
  const [state, setState] = useState({ slug, status: 'live' as StreamStatus, resyncedAt: 0 })
  useEffect(() => {
    if (typeof EventSource === 'undefined') return
    const update = (patch: { status: StreamStatus; resyncedAt?: number }) =>
      setState((s) => ({ ...(s.slug === slug ? s : { slug, status: 'live' as StreamStatus, resyncedAt: 0 }), ...patch }))
    const refresh = () => void qc.invalidateQueries({ queryKey: eventKeys.detail(slug) })

    let es: EventSource
    let missed = false // the stream failed since it was last open: messages may be lost
    let failedReopens = 0
    let notice: ReturnType<typeof setTimeout> | undefined
    let reopen: ReturnType<typeof setTimeout> | undefined

    const onOpen = () => {
      clearTimeout(notice)
      notice = undefined
      failedReopens = 0
      if (!missed) return update({ status: 'live' })
      missed = false
      refresh()
      update({ status: 'live', resyncedAt: Date.now() })
    }
    const onError = () => {
      missed = true
      notice ??= setTimeout(() => update({ status: 'reconnecting' }), STREAM_DOWN_NOTICE_MS)
      if (es.readyState !== EventSource.CLOSED) return // the browser retries by itself
      // The browser gave up, e.g. a proxy answered 502 during a deploy. Open a
      // new stream, waiting longer each time; the OBS overlay depends on it.
      failedReopens++
      if (failedReopens >= STREAM_REOPEN_NOTICE_AFTER) update({ status: 'closed' })
      reopen = setTimeout(connect, Math.min(STREAM_REOPEN_FIRST_MS * 2 ** (failedReopens - 1), STREAM_REOPEN_MAX_MS))
    }
    const connect = () => {
      es = new EventSource(`${base(slug)}/stream`)
      es.addEventListener('change', refresh)
      es.addEventListener('open', onOpen)
      es.addEventListener('error', onError)
    }

    connect()
    return () => {
      clearTimeout(notice)
      clearTimeout(reopen)
      es.close()
    }
  }, [slug, qc])
  return state.slug === slug ? { status: state.status, resyncedAt: state.resyncedAt } : { status: 'live', resyncedAt: 0 }
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
