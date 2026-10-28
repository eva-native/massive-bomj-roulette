import { expect, it, vi } from 'vitest'
import { api, ApiError, NETWORK_ERROR } from './client'

it.each(['Failed to fetch', 'NetworkError when attempting to fetch resource.', 'Load failed'])(
  'turns a failed connection (%s) into a readable error',
  async (browserText) => {
    const cause = new TypeError(browserText)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(cause))
    const err = await api('/api/me').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 0, message: NETWORK_ERROR, cause })
  },
)

it('passes a malformed request through: it is a bug, not a lost connection', async () => {
  const bug = new TypeError("Failed to execute 'fetch' on 'Window': Invalid value")
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(bug))
  await expect(api('/api/me')).rejects.toBe(bug)
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
