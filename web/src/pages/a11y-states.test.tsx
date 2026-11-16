import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import type { EventDetail } from '@/api/types.gen'
import { eventKeys } from '@/api/events'
import { fakeBackend } from '@/test/fakeBackend'
import { renderApp } from '@/test/renderApp'

const judge = { id: 1, name: 'Судья', avatarUrl: '', isAdmin: true }

it('gives a missing event an explanation and a way out', async () => {
  vi.stubGlobal('fetch', fakeBackend().fetch)
  renderApp('/e/missing')
  expect(await screen.findByRole('heading', { name: 'Ивент не найден' }, { timeout: 4000 })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'К ивентам' })).toHaveAttribute('href', '/')
})

it('keeps a dirty settings form when refreshing the event fails', async () => {
  const backend = fakeBackend({ me: judge })
  backend.addEvent('lbr', 'ЛБР', judge)
  let failed = false
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => failed && String(input) === '/api/events/lbr'
    ? Promise.resolve(new Response(JSON.stringify({ error: 'Временно недоступно' }), { status: 502 }))
    : backend.fetch(input, init))
  const { queryClient } = renderApp('/e/lbr/settings')
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('Название'), ' правка')
  failed = true
  await act(() => queryClient.invalidateQueries({ queryKey: eventKeys.detail('lbr'), exact: true }))
  expect(await screen.findByText('Временно недоступно')).toBeInTheDocument()
  expect(screen.getByLabelText('Название')).toHaveValue('ЛБР правка')
  expect(screen.getByText('Есть несохранённые изменения')).toBeInTheDocument()
})

it('shows loading and a failure on the login page', async () => {
  const backend = fakeBackend()
  let release!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve })
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === '/api/config') {
      await pending
      return new Response(JSON.stringify({ error: 'Вход временно недоступен' }), { status: 503 })
    }
    return backend.fetch(input, init)
  })
  renderApp('/login')
  expect(screen.getByText('Загрузка…')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '← К ивентам' })).toHaveAttribute('href', '/')
  release()
  expect(await screen.findByRole('alert', {}, { timeout: 4000 })).toHaveTextContent('Вход временно недоступен')
})

it('offers a selected invitation when the clipboard rejects the write', async () => {
  const backend = fakeBackend({ me: judge })
  backend.addEvent('lbr', 'ЛБР', judge)
  const ev = await (await backend.fetch('/api/events/lbr')).json() as EventDetail
  await backend.fetch('/api/events/lbr', { method: 'PATCH', body: JSON.stringify({ settings: { ...ev.settings, inviteOnly: true, inviteCode: 'abc' } }) })
  vi.stubGlobal('fetch', backend.fetch)
  const user = userEvent.setup()
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new DOMException('denied'))
  renderApp('/e/lbr/settings')
  await user.click(await screen.findByRole('button', { name: 'Копировать' }))
  const input = screen.getByLabelText('Ссылка-приглашение') as HTMLInputElement
  expect(await screen.findByText('Скопируйте вручную.')).toBeInTheDocument()
  expect(input).toHaveFocus()
  expect(input.selectionStart).toBe(0)
  expect(input.selectionEnd).toBe(input.value.length)
  copy.mockRestore()
})

it('shows a short diagnostic in an overlay whose event does not exist', async () => {
  vi.stubGlobal('fetch', fakeBackend().fetch)
  renderApp('/e/missing/overlay')
  expect(await screen.findByRole('alert', {}, { timeout: 4000 })).toHaveTextContent('MBR: ивент «missing» не найден')
})
