import { act, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ME_RETRY_MS } from '@/api/hooks'
import type { Me } from '@/api/types.gen'
import { fakeBackend } from '@/test/fakeBackend'
import { renderApp } from '@/test/renderApp'

const alice: Me = { id: 2, name: 'Алиса', avatarUrl: '', isAdmin: false }

afterEach(() => {
  vi.useRealTimers()
})

it('offers to log in when nobody is logged in', async () => {
  vi.stubGlobal('fetch', fakeBackend({ me: null }).fetch)
  renderApp('/')
  expect(await screen.findByRole('link', { name: 'Войти' })).toBeInTheDocument()
})

it('says the server is down instead of offering to log in, and recovers by itself', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const backend = fakeBackend({ me: alice })
  let down = true
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
    down && String(input) === '/api/me' ? Promise.resolve(new Response(JSON.stringify({ error: 'ошибка' }), { status: 502 })) : backend.fetch(input, init),
  )
  renderApp('/')

  await act(() => vi.advanceTimersByTimeAsync(2000)) // useMe retries once before giving up
  expect(screen.getByText('Сервер недоступен')).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Войти' })).not.toBeInTheDocument()

  down = false
  await act(() => vi.advanceTimersByTimeAsync(ME_RETRY_MS))
  expect(screen.getByRole('button', { name: 'Выйти' })).toBeInTheDocument()
  expect(screen.queryByText('Сервер недоступен')).not.toBeInTheDocument()
})
