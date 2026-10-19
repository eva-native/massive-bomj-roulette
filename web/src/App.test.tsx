import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { fakeBackend } from '@/test/fakeBackend'
import { renderApp } from '@/test/renderApp'

describe('login', () => {
  it('sends anonymous users to the login page and shows enabled methods', async () => {
    const backend = fakeBackend({ config: { discordLogin: true, devLogin: false } })
    vi.stubGlobal('fetch', backend.fetch)
    renderApp('/')

    expect(await screen.findByRole('link', { name: 'Войти через Discord' })).toHaveAttribute('href', '/auth/discord/login')
    expect(screen.queryByText('Вход для разработки')).not.toBeInTheDocument()
  })

  it('logs in with dev login and logs out', async () => {
    const backend = fakeBackend()
    vi.stubGlobal('fetch', backend.fetch)
    const user = userEvent.setup()
    renderApp('/')

    await user.type(await screen.findByLabelText('Вход для разработки'), 'Алиса')
    await user.click(screen.getByRole('button', { name: 'Войти как «Алиса»' }))
    expect(await screen.findByRole('heading', { name: 'Ивенты' })).toBeInTheDocument()
    expect(screen.getByText('Алиса')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Выйти' }))
    expect(await screen.findByLabelText('Вход для разработки')).toBeInTheDocument()
  })
})
