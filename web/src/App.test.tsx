import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { AppConfig, Me } from '@/api/types.gen'
import { newQueryClient } from '@/api/queryClient'
import { routes } from '@/routes'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

/** A tiny fake backend: dev login sets the user, logout clears it. */
function fakeBackend(config: AppConfig) {
  let me: Me | null = null
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/config') return json(200, config)
    if (url === '/api/me') return me ? json(200, me) : json(401, { error: 'not logged in' })
    if (url === '/auth/dev/login' && init?.method === 'POST') {
      const { name } = JSON.parse(String(init.body)) as { name: string }
      me = { id: 1, name, avatarUrl: '', isAdmin: false }
      return json(200, me)
    }
    if (url === '/auth/logout') {
      me = null
      return new Response(null, { status: 204 })
    }
    return json(404, { error: 'not found' })
  })
}

function renderApp(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <QueryClientProvider client={newQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

describe('login', () => {
  it('sends anonymous users to the login page and shows enabled methods', async () => {
    vi.stubGlobal('fetch', fakeBackend({ discordLogin: true, devLogin: false }))
    renderApp('/')

    expect(await screen.findByRole('link', { name: 'Войти через Discord' })).toHaveAttribute('href', '/auth/discord/login')
    expect(screen.queryByLabelText('Вход для разработки')).not.toBeInTheDocument()
  })

  it('logs in with dev login and logs out', async () => {
    vi.stubGlobal('fetch', fakeBackend({ discordLogin: false, devLogin: true }))
    const user = userEvent.setup()
    renderApp('/')

    await user.type(await screen.findByLabelText('Вход для разработки'), 'Алиса')
    await user.click(screen.getByRole('button', { name: 'Войти как «Алиса»' }))
    expect(await screen.findByText('Привет, Алиса!')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Выйти' }))
    expect(await screen.findByLabelText('Вход для разработки')).toBeInTheDocument()
  })
})
