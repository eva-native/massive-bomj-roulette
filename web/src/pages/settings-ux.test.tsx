import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { fakeBackend } from '@/test/fakeBackend'
import { renderApp } from '@/test/renderApp'

const judge = { id: 1, name: 'Судья', avatarUrl: '', isAdmin: true }

it('only marks the submitted snapshot as saved, retaining edits made during the request', async () => {
  const backend = fakeBackend({ me: judge })
  backend.addEvent('lbr', 'ЛБР', judge)
  let release!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve })
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'PATCH') await pending
    return backend.fetch(input, init)
  })
  renderApp('/e/lbr/settings')
  const user = userEvent.setup()
  const name = await screen.findByLabelText('Название')
  expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled()
  await user.type(name, ' 2')
  expect(screen.getByText('Есть несохранённые изменения')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Сохранить' }))
  expect(screen.getByRole('button', { name: 'Сохранение…' })).toBeDisabled()
  await user.type(name, ' 3')
  await act(async () => { release(); await pending })
  await screen.findByRole('button', { name: 'Сохранить' })
  expect(screen.getByText('Есть несохранённые изменения')).toBeInTheDocument()
  expect(screen.queryByText('Сохранено')).not.toBeInTheDocument()
  expect(backend.requests.find((r) => r.method === 'PATCH')?.body).toMatchObject({ title: 'ЛБР 2' })
  await user.click(screen.getByRole('button', { name: 'Сохранить' }))
  await screen.findByText('Сохранено')
  await user.type(name, ' 4')
  expect(screen.queryByText('Сохранено')).not.toBeInTheDocument()
})

it('warns on leaving a dirty form and on unload, but allows section anchors', async () => {
  const backend = fakeBackend({ me: judge })
  backend.addEvent('lbr', 'ЛБР', judge)
  vi.stubGlobal('fetch', backend.fetch)
  const { router } = renderApp('/e/lbr/settings')
  const user = userEvent.setup()
  fireEvent.change(await screen.findByLabelText('Название'), { target: { value: 'Новое' } })
  const unload = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(unload)
  expect(unload.defaultPrevented).toBe(true)
  const sections = screen.getByRole('navigation', { name: 'Разделы настроек' })
  for (const link of within(sections).getAllByRole('link')) {
    expect(document.querySelector(link.getAttribute('href')!)).toBeInTheDocument()
  }
  await act(async () => { await router.navigate('/e/lbr/settings#settings-items') })
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  await user.click(screen.getByRole('link', { name: 'Игры' }))
  const dialog = await screen.findByRole('alertdialog', { name: 'Несохранённые настройки' })
  expect(within(dialog).getByRole('button', { name: 'Остаться' })).toHaveFocus()
  await user.click(within(dialog).getByRole('button', { name: 'Остаться' }))
  expect(screen.getByLabelText('Название')).toHaveValue('Новое')
  await user.click(screen.getByRole('link', { name: 'Игры' }))
  await user.click(await screen.findByRole('button', { name: 'Уйти без сохранения' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/e/lbr/games'))
  const cleanUnload = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(cleanUnload)
  expect(cleanUnload.defaultPrevented).toBe(false)
})
