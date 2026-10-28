import { expect, it, vi } from 'vitest'
import { api, ApiError, NETWORK_ERROR } from './client'

it('turns a failed connection into a readable error', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
  const err = await api('/api/me').catch((e: unknown) => e)
  expect(err).toBeInstanceOf(ApiError)
  expect(err).toMatchObject({ status: 0, message: NETWORK_ERROR })
})

it('passes other failures through', async () => {
  const abort = new DOMException('The operation was aborted.', 'AbortError')
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abort))
  await expect(api('/api/me')).rejects.toBe(abort)
})

it('uses the server message for an error answer', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'нет прав' }), { status: 403 })))
  await expect(api('/api/events')).rejects.toMatchObject({ status: 403, message: 'нет прав' })
})
