import { screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { fakeBackend } from '@/test/fakeBackend'
import { renderApp } from '@/test/renderApp'

it('offers to log in when nobody is logged in', async () => {
  vi.stubGlobal('fetch', fakeBackend({ me: null }).fetch)
  renderApp('/')
  expect(await screen.findByRole('link', { name: 'Войти' })).toBeInTheDocument()
})

it('does not pretend the user is logged out when the server is down', async () => {
  const backend = fakeBackend({ me: null })
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
    String(input) === '/api/me' ? Promise.resolve(new Response(JSON.stringify({ error: 'ошибка' }), { status: 502 })) : backend.fetch(input, init),
  )
  renderApp('/')
  // useMe retries once before giving up.
  expect(await screen.findByText('Сервер недоступен', undefined, { timeout: 3000 })).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Войти' })).not.toBeInTheDocument()
})
