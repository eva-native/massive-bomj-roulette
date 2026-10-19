import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { fakeBackend } from '@/test/fakeBackend'
import { renderApp } from '@/test/renderApp'

describe('login', () => {
  it('lets anonymous visitors look around and offers to log in', async () => {
    const backend = fakeBackend({ config: { discordLogin: true, devLogin: false } })
    vi.stubGlobal('fetch', backend.fetch)
    const user = userEvent.setup()
    renderApp('/')

    expect(await screen.findByRole('heading', { name: 'Ивенты' })).toBeInTheDocument()
    await user.click(await screen.findByRole('link', { name: 'Войти' }))
    expect(await screen.findByRole('link', { name: 'Войти через Discord' })).toHaveAttribute('href', '/auth/discord/login')
    expect(screen.queryByText('Вход для разработки')).not.toBeInTheDocument()
  })

  it('logs in with dev login, returns to the page and logs out', async () => {
    const backend = fakeBackend()
    vi.stubGlobal('fetch', backend.fetch)
    const user = userEvent.setup()
    const { router } = renderApp('/login?next=/e/nope')

    await user.type(await screen.findByLabelText('Вход для разработки'), 'Алиса')
    await user.click(screen.getByRole('button', { name: 'Войти как «Алиса»' }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/e/nope')) // back where the visitor came from

    await router.navigate('/')
    expect(await screen.findByText('Алиса')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Выйти' }))
    expect(await screen.findByRole('link', { name: 'Войти' })).toBeInTheDocument()
  })

  it('never redirects outside the site after login', async () => {
    const backend = fakeBackend({ me: { id: 1, name: 'Алиса', avatarUrl: '', isAdmin: false } })
    vi.stubGlobal('fetch', backend.fetch)
    const { router } = renderApp('/login?next=//evil.example')
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })
})
