import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from './client'
import type { AppConfig, DevLoginRequest, Me } from './types.gen'

export const queryKeys = {
  config: ['config'] as const,
  me: ['me'] as const,
}

export function useAppConfig() {
  return useQuery({
    queryKey: queryKeys.config,
    queryFn: () => api<AppConfig>('/api/config'),
    staleTime: Infinity,
  })
}

/** The logged-in user, or null when nobody is logged in. */
export function useMe() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: async () => {
      try {
        return await api<Me>('/api/me')
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null
        throw err
      }
    },
  })
}

export function useDevLogin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: DevLoginRequest) => api<Me>('/auth/dev/login', { method: 'POST', json: req }),
    onSuccess: (me) => qc.setQueryData(queryKeys.me, me),
  })
}

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST' }),
    onSuccess: () => qc.setQueryData(queryKeys.me, null),
  })
}
