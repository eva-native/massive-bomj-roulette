import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import type { Me, PlayerView, QueueEntry } from '@/api/types.gen'
import { playKeys } from '@/api/play'
import { timerKey } from '@/lib/localTimer'
import { fakeBackend } from '@/test/fakeBackend'
import { renderApp } from '@/test/renderApp'

const alice: Me = { id: 2, name: 'Алиса', avatarUrl: '', isAdmin: false }
const judge: Me = { id: 1, name: 'Судья', avatarUrl: '', isAdmin: true }
const pt = { id: 70, gameId: 5, game: 'Portal', hltbHours: 3, basePoints: 12, coverUrl: '', outcome: '', hours: 0, proof: '', review: '', confirmed: false, points: 0, timerMs: 0 }
const view = (canAct = true): PlayerView => ({
  player: alice, canAct, pocket: [], history: [], points: 0, entries: [],
  turn: { id: 10, number: 1, reason: 'start', items: [], wheel: null, waiting: '', playthrough: pt,
    steps: [{ id: 13, kind: 'play', done: false, result: '', addedBy: '', options: [] }],
    current: { id: 13, kind: 'play', done: false, result: '', addedBy: '', options: [] } },
})

async function setup(member = true) {
  const backend = fakeBackend({ me: alice })
  backend.addEvent('lbr', 'ЛБР', judge)
  if (member) await backend.fetch('/api/events/lbr/join', { method: 'POST' })
  backend.on('GET', /\/players\/\d+$/, () => view())
  backend.on('GET', /\/playtime$/, () => ({ playthrough: 70, totalMs: 0, canEdit: true }))
  vi.stubGlobal('fetch', backend.fetch)
  return backend
}
const tabs = () => within(screen.getByRole('navigation', { name: 'Разделы ивента' }))

it('opens the participant’s turn from the event list and after joining', async () => {
  await setup(false)
  const user = userEvent.setup()
  const { router } = renderApp('/')
  const event = await screen.findByRole('link', { name: /ЛБР Участников/ })
  expect(event).toHaveAttribute('href', '/e/lbr')
  await user.click(event)
  await user.click(await screen.findByRole('button', { name: 'Участвовать' }))
  await screen.findByRole('radio', { name: 'Прошёл' })
  expect(router.state.location.pathname).toBe('/e/lbr/play')
  await act(() => router.navigate('/'))
  expect(await screen.findByRole('link', { name: /ЛБР Участников/ })).toHaveAttribute('href', '/e/lbr/play')
})

it('keeps shared event links on the table, and marks the appropriate tab on player boards', async () => {
  await setup()
  const { router } = renderApp('/e/lbr')
  expect(await screen.findByRole('heading', { name: 'Очки' })).toBeInTheDocument()
  expect(tabs().getByRole('link', { name: 'Таблица' })).toHaveAttribute('aria-current', 'page')
  await act(() => router.navigate('/e/lbr/players/2'))
  expect(tabs().getByRole('link', { name: /^Мой ход/ })).toHaveAttribute('aria-current', 'page')
  await act(() => router.navigate('/e/lbr/players/1'))
  expect(tabs().getByRole('link', { name: 'Таблица' })).toHaveAttribute('aria-current', 'page')
  expect(tabs().getByRole('link', { name: /^Мой ход/ })).not.toHaveAttribute('aria-current')
})

it('updates the action marker as live player data changes', async () => {
  const backend = await setup()
  const { queryClient } = renderApp('/e/lbr/games')
  await screen.findByRole('link', { name: 'Мой ход — ждёт вас' })
  backend.on('GET', /\/players\/2$/, () => view(false))
  await act(() => queryClient.invalidateQueries({ queryKey: playKeys.player('lbr', 2) }))
  expect(await tabs().findByRole('link', { name: 'Мой ход' })).toBeInTheDocument()
  expect(tabs().queryByRole('link', { name: /ждёт вас/ })).not.toBeInTheDocument()
})

it('tracks the actual timer across tabs, and responds to changes from another browser tab', async () => {
  await setup()
  const user = userEvent.setup()
  renderApp('/e/lbr/play')
  await user.click(await screen.findByRole('button', { name: 'Старт' }))
  expect(await screen.findByRole('link', { name: 'Мой ход — таймер идёт' })).toBeInTheDocument()
  await user.click(tabs().getByRole('link', { name: 'Игры' }))
  expect(tabs().getByRole('link', { name: 'Мой ход — таймер идёт' })).toBeInTheDocument()
  localStorage.setItem(timerKey('lbr', 70), JSON.stringify({ elapsedMs: 5000, startedAt: null }))
  fireEvent(window, new StorageEvent('storage', { key: timerKey('lbr', 70) }))
  expect(tabs().getByRole('link', { name: 'Мой ход — ждёт вас' })).toBeInTheDocument()
})

it('does not show another event’s timer and restores the browser title on leaving', async () => {
  const backend = await setup()
  backend.addEvent('other', 'Другой', judge)
  await backend.fetch('/api/events/other/join', { method: 'POST' })
  localStorage.setItem(timerKey('lbr', 70), JSON.stringify({ elapsedMs: 0, startedAt: Date.now() }))
  document.title = 'MBR'
  const { router } = renderApp('/e/lbr/games')
  await screen.findByRole('link', { name: 'Мой ход — таймер идёт' })
  expect(document.title).toBe('Игры · ЛБР · MBR')
  await act(() => router.navigate('/e/other/games'))
  await screen.findByRole('heading', { name: 'Другой' })
  expect(tabs().queryByRole('link', { name: /таймер идёт/ })).not.toBeInTheDocument()
  expect(document.title).toBe('Игры · Другой · MBR')
  await act(() => router.navigate('/'))
  expect(document.title).toBe('MBR')
})

it('shows queue size in the browser title and keeps external rules out of the tabs', async () => {
  const backend = await setup(false)
  backend.setMe(judge)
  let queue: QueueEntry[] = [{ kind: 'playthrough', id: 70, player: alice, title: 'Portal', playthrough: { ...pt, outcome: 'completed' }, item: null, game: 'Portal' }]
  backend.on('GET', /\/queue$/, () => queue)
  const { queryClient } = renderApp('/e/lbr/judge')
  await screen.findByRole('link', { name: 'Судья (1)' })
  expect(document.title).toBe('Судья (1) · ЛБР · MBR')
  expect(screen.getByRole('link', { name: 'Правила ивента ↗' })).toHaveAttribute('target', '_blank')
  expect(tabs().queryByRole('link', { name: /Правила/ })).not.toBeInTheDocument()
  queue = []
  await act(() => queryClient.invalidateQueries({ queryKey: playKeys.queue('lbr') }))
  await waitFor(() => expect(document.title).toBe('Судья · ЛБР · MBR'))
})

it('does not request a personal board for guests or judge-only members', async () => {
  const backend = await setup(false)
  backend.setMe(null)
  renderApp('/e/lbr')
  await screen.findByRole('heading', { name: 'ЛБР' })
  expect(backend.requests.some((r) => /\/players\//.test(r.url))).toBe(false)
  expect(tabs().queryByRole('link', { name: /^Мой ход/ })).not.toBeInTheDocument()
})

it.each([false, true])('marks a pending item result while the game outcome waits for the judge (rejected: %s)', async (rejected) => {
  const backend = await setup()
  const waiting = view(false)
  waiting.turn!.current = null
  waiting.turn!.steps[0]!.done = true
  waiting.turn!.playthrough = { ...pt, outcome: 'completed', hours: 3 }
  waiting.turn!.waiting = 'Итог ждёт подтверждения судьи'
  waiting.turn!.items = [{
    id: 50, defId: 'duel', name: 'Дуэль', concept: 'Результат дуэли', kind: 'effect', placement: 'attached',
    blocked: false, status: '', note: '', needsConfirm: true, confirmed: false, rejected, locked: false,
    rejectReason: rejected ? 'Уточните результат' : '', useLabel: '', canUse: false, useHint: '',
    fields: [{ name: 'won', label: 'Победа', type: 'bool', by: 'player', optional: false, value: null }],
  }]
  backend.on('GET', /\/players\/2$/, () => waiting)
  const { queryClient, router } = renderApp('/e/lbr/play')
  expect(await screen.findByText('Нужно действие')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Отправить результат' })).toBeEnabled()
  await act(() => router.navigate('/e/lbr/games'))
  expect(queryClient.getQueryData(playKeys.player('lbr', 2))).toEqual(waiting)
  expect(tabs().getByRole('link', { name: 'Мой ход — ждёт вас' })).toBeInTheDocument()
  // Blocked items do not need a response; an unblocked item waits again.
  const item = waiting.turn!.items[0]!
  item.blocked = true
  await act(() => queryClient.invalidateQueries({ queryKey: playKeys.player('lbr', 2) }))
  expect(await tabs().findByRole('link', { name: 'Мой ход' })).toBeInTheDocument()
  item.blocked = false
  await act(() => queryClient.invalidateQueries({ queryKey: playKeys.player('lbr', 2) }))
  expect(await tabs().findByRole('link', { name: 'Мой ход — ждёт вас' })).toBeInTheDocument()
  // Sending the result removes the marker even though the judge has not confirmed it yet.
  item.locked = true
  item.rejected = false
  item.rejectReason = ''
  item.fields[0]!.value = true
  await act(() => queryClient.invalidateQueries({ queryKey: playKeys.player('lbr', 2) }))
  expect(await tabs().findByRole('link', { name: 'Мой ход' })).toBeInTheDocument()
})
