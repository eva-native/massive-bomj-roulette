import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type {
  CreateEventRequest,
  EventDetail,
  EventSummary,
  Game,
  GameInput,
  ItemDef,
  Movie,
  MovieInput,
  UpdateEventRequest,
  UpdateMemberRequest,
} from './types.gen'

export const eventKeys = {
  list: ['events'] as const,
  detail: (slug: string) => ['events', slug] as const,
  items: (slug: string) => ['events', slug, 'items'] as const,
  games: (slug: string) => ['events', slug, 'games'] as const,
  movies: (slug: string) => ['events', slug, 'movies'] as const,
}

const base = (slug: string) => `/api/events/${encodeURIComponent(slug)}`

export function useEvents() {
  return useQuery({ queryKey: eventKeys.list, queryFn: () => api<EventSummary[]>('/api/events') })
}

export function useEvent(slug: string) {
  return useQuery({ queryKey: eventKeys.detail(slug), queryFn: () => api<EventDetail>(base(slug)) })
}

export function useItems(slug: string) {
  return useQuery({ queryKey: eventKeys.items(slug), queryFn: () => api<ItemDef[]>(`${base(slug)}/items`) })
}

export function useGames(slug: string) {
  return useQuery({ queryKey: eventKeys.games(slug), queryFn: () => api<Game[]>(`${base(slug)}/games`) })
}

export function useMovies(slug: string) {
  return useQuery({ queryKey: eventKeys.movies(slug), queryFn: () => api<Movie[]>(`${base(slug)}/movies`) })
}

export function useCreateEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: CreateEventRequest) => api<EventDetail>('/api/events', { method: 'POST', json: req }),
    onSuccess: (ev) => {
      qc.setQueryData(eventKeys.detail(ev.slug), ev)
      void qc.invalidateQueries({ queryKey: eventKeys.list, exact: true })
    },
  })
}

/** Mutations that return the updated event detail. */
function useEventMutation<V>(slug: string, fn: (v: V) => Promise<EventDetail>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: (ev) => {
      qc.setQueryData(eventKeys.detail(slug), ev)
      void qc.invalidateQueries({ queryKey: eventKeys.list, exact: true })
      void qc.invalidateQueries({ queryKey: eventKeys.items(slug) })
    },
  })
}

export function useUpdateEvent(slug: string) {
  return useEventMutation(slug, (req: UpdateEventRequest) => api<EventDetail>(base(slug), { method: 'PATCH', json: req }))
}

export function useJoinEvent(slug: string) {
  return useEventMutation(slug, () => api<EventDetail>(`${base(slug)}/join`, { method: 'POST' }))
}

export function useUpdateMember(slug: string) {
  return useEventMutation(slug, ({ userId, ...req }: UpdateMemberRequest & { userId: number }) =>
    api<EventDetail>(`${base(slug)}/members/${userId}`, { method: 'PATCH', json: req }),
  )
}

export function useRemoveMember(slug: string) {
  return useEventMutation(slug, (userId: number) =>
    api<EventDetail>(`${base(slug)}/members/${userId}`, { method: 'DELETE' }),
  )
}

/** Create, update and delete mutations for a pool list (games or movies). */
function usePoolMutations<Input>(slug: string, kind: 'games' | 'movies') {
  const qc = useQueryClient()
  const key = kind === 'games' ? eventKeys.games(slug) : eventKeys.movies(slug)
  const url = `${base(slug)}/${kind}`
  const onSuccess = () => qc.invalidateQueries({ queryKey: key })
  return {
    add: useMutation({ mutationFn: (input: Input) => api(url, { method: 'POST', json: input }), onSuccess }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: number; input: Input }) => api(`${url}/${id}`, { method: 'PATCH', json: input }),
      onSuccess,
    }),
    remove: useMutation({ mutationFn: (id: number) => api<void>(`${url}/${id}`, { method: 'DELETE' }), onSuccess }),
  }
}

export const useGameMutations = (slug: string) => usePoolMutations<GameInput>(slug, 'games')
export const useMovieMutations = (slug: string) => usePoolMutations<MovieInput>(slug, 'movies')
