import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import type { EventDetail, ItemDef, Me } from '@/api/types.gen'
import { fakeBackend } from '@/test/fakeBackend'
import { renderApp } from '@/test/renderApp'

const judge: Me = { id: 1, name: 'Судья', avatarUrl: '', isAdmin: true }
const alice: Me = { id: 2, name: 'Алиса', avatarUrl: '', isAdmin: false }
const item = (id: string, kind: string, weight: number): ItemDef => ({ id, name: id, kind, concept: `Правило ${id}`, weight, defaultWeight: weight, enabled: true, params: [], specialGames: [] })

it('searches rules without changing their probability denominator; disabled items stay last', async () => {
  const backend = fakeBackend({ items: [item('off', 'effect', 100), item('effect', 'effect', 1), item('bonus', 'bonus', 3), item('drop', 'drop', 1)] })
  backend.addEvent('lbr', 'ЛБР', judge)
  const ev = await (await backend.fetch('/api/events/lbr')).json() as EventDetail
  await backend.fetch('/api/events/lbr', { method: 'PATCH', body: JSON.stringify({ settings: { ...ev.settings, disabled: ['off'] } }) })
  vi.stubGlobal('fetch', backend.fetch)
  renderApp('/e/lbr/rules')
  const heading = await screen.findByRole('heading', { name: 'effect' })
  expect(within(heading.closest('article')!).getByText('шанс 25 %')).toBeInTheDocument()
  expect(within(screen.getByRole('heading', { name: 'drop' }).closest('article')!).getByText('шанс 100 %')).toBeInTheDocument()
  screen.getAllByRole('article').forEach((el, i) => expect(within(el).getByRole('heading')).toHaveAccessibleName(['effect', 'off', 'bonus', 'drop'][i]))
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ПРАВИЛО EFFECT' } })
  expect(screen.getAllByRole('article')).toHaveLength(1)
  expect(screen.getByText('шанс 25 %')).toBeInTheDocument()
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'нет такого' } })
  expect(screen.getByText('Ничего не найдено.')).toHaveAttribute('role', 'status')
})

it('prevents adding at the limit while allowing an existing game to be edited', async () => {
  const backend = fakeBackend({ me: alice })
  backend.addEvent('lbr', 'ЛБР', judge, { games: [{ id: 7, title: 'Игра', hltbHours: 10, rating: 8, year: 2015, specialKey: '', basePoints: 17, addedBy: 2, addedByName: 'Алиса', coverUrl: '' }] })
  await backend.fetch('/api/events/lbr/join', { method: 'POST' })
  const ev = await (await backend.fetch('/api/events/lbr')).json() as EventDetail
  await backend.fetch('/api/events/lbr', { method: 'PATCH', body: JSON.stringify({ settings: { ...ev.settings, maxGamesPerMember: 1 } }) })
  vi.stubGlobal('fetch', backend.fetch)
  renderApp('/e/lbr/games')
  await screen.findByText('Лимит: 1 из 1. Удалите свою игру, чтобы добавить другую.')
  expect(screen.getByRole('button', { name: 'Добавить' })).toBeDisabled()
  expect(screen.getByText('база 17')).toBeInTheDocument()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Изменить' }))
  const form = screen.getByRole('button', { name: 'Сохранить' }).closest('form')!
  expect(within(form).getByLabelText('Название')).toBeEnabled()
  expect(within(form).getByLabelText('Название')).toHaveFocus()
  expect(within(form).getByLabelText('Рейтинг (из 100)')).toHaveValue(8)
  expect(screen.getByText(/Похоже на оценку из 5 или 10/)).toBeInTheDocument()
  await user.keyboard('{Escape}')
  expect(screen.getByRole('button', { name: 'Изменить' })).toHaveFocus()
  await user.click(screen.getByRole('button', { name: 'Изменить' }))
  await user.click(screen.getByRole('button', { name: 'Отмена' }))
  expect(screen.getByRole('button', { name: 'Изменить' })).toHaveFocus()
})

it('only turns HTTP movie titles into links', async () => {
  const backend = fakeBackend()
  backend.addEvent('lbr', 'ЛБР', judge, { movies: ['https://example.com/movie', 'javascript:alert(1)'].map((title, id) => ({ id, title, addedBy: 1, addedByName: 'Судья' })) })
  vi.stubGlobal('fetch', backend.fetch)
  renderApp('/e/lbr/movies')
  expect(await screen.findByRole('link', { name: 'https://example.com/movie' })).toHaveAttribute('target', '_blank')
  expect(screen.getByText('javascript:alert(1)')).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'javascript:alert(1)' })).not.toBeInTheDocument()
})

it('focuses a movie title on edit and restores the trigger on Escape', async () => {
  const backend = fakeBackend({ me: judge })
  backend.addEvent('lbr', 'ЛБР', judge, { movies: [{ id: 7, title: 'Фильм', addedBy: 1, addedByName: 'Судья' }] })
  vi.stubGlobal('fetch', backend.fetch)
  const user = userEvent.setup()
  renderApp('/e/lbr/movies')
  await user.click(await screen.findByRole('button', { name: 'Изменить' }))
  expect(screen.getByDisplayValue('Фильм')).toHaveFocus()
  await user.keyboard('{Escape}')
  expect(screen.getByRole('button', { name: 'Изменить' })).toHaveFocus()
})

it('keeps focus in the newly opened game editor when switching rows', async () => {
  const backend = fakeBackend({ me: judge })
  backend.addEvent('lbr', 'ЛБР', judge, { games: ['Первая', 'Вторая'].map((title, id) => ({ id, title, hltbHours: 10, rating: 80, year: 2015, specialKey: '', basePoints: 17, addedBy: 1, addedByName: 'Судья', coverUrl: '' })) })
  vi.stubGlobal('fetch', backend.fetch)
  const user = userEvent.setup()
  renderApp('/e/lbr/games')
  const second = (await screen.findByText('Вторая')).closest('li')!
  await user.click(within(second).getByRole('button', { name: 'Изменить' }))
  const first = screen.getByText('Первая').closest('li')!
  await user.click(within(first).getByRole('button', { name: 'Изменить' }))
  expect(screen.getByDisplayValue('Первая')).toHaveFocus()
})

it('requires the judge to choose the participant when submitting an ordinary game', async () => {
  const backend = fakeBackend({ me: alice })
  backend.addEvent('lbr', 'ЛБР', judge)
  await backend.fetch('/api/events/lbr/join', { method: 'POST' })
  backend.setMe(judge)
  const ev = await (await backend.fetch('/api/events/lbr')).json() as EventDetail
  await backend.fetch('/api/events/lbr', { method: 'PATCH', body: JSON.stringify({ settings: { ...ev.settings, judgeGameSubmissions: true } }) })
  const add = vi.fn()
  backend.on('POST', /\/games$/, (body) => { add(body); return {} })
  vi.stubGlobal('fetch', backend.fetch)
  renderApp('/e/lbr/games')
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('Название'), 'Portal')
  const button = screen.getByRole('button', { name: 'Добавить' })
  expect(button).toBeDisabled()
  await user.selectOptions(screen.getByLabelText('От какого участника'), String(alice.id))
  await user.click(button)
  expect(add).toHaveBeenCalledWith(expect.objectContaining({ submittedBy: alice.id, title: 'Portal' }))
})

it('hides the author edit button after submissions close', async () => {
  const backend = fakeBackend({ me: alice })
  backend.addEvent('lbr', 'ЛБР', judge, { games: [{ id: 7, title: 'Portal', hltbHours: 3, rating: 90, year: 2007, specialKey: '', basePoints: 6, addedBy: alice.id, addedByName: alice.name, coverUrl: '' }] })
  await backend.fetch('/api/events/lbr/join', { method: 'POST' })
  const event = await (await backend.fetch('/api/events/lbr')).json() as EventDetail
  await backend.fetch('/api/events/lbr', { method: 'PATCH', body: JSON.stringify({ settings: { ...event.settings, gameSubmissionDeadline: '2020-01-01' } }) })
  vi.stubGlobal('fetch', backend.fetch)
  renderApp('/e/lbr/games')
  await screen.findByText('Portal')
  expect(screen.queryByRole('button', { name: 'Изменить' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Удалить' })).toBeEnabled()
})

it('keeps special games outside the ordinary pool when edited in judge mode', async () => {
  const effect = { ...item('smuta', 'effect', 1), specialGames: [{ key: 'smuta', title: 'Смута' }] }
  const backend = fakeBackend({ me: judge, items: [effect] })
  backend.addEvent('lbr', 'ЛБР', judge, { games: [{ id: 7, title: 'Смута', hltbHours: 12, rating: 40, year: 2024, specialKey: 'smuta', basePoints: 12, addedBy: judge.id, addedByName: judge.name, coverUrl: '' }] })
  const event = await (await backend.fetch('/api/events/lbr')).json() as EventDetail
  await backend.fetch('/api/events/lbr', { method: 'PATCH', body: JSON.stringify({ settings: { ...event.settings, judgeGameSubmissions: true } }) })
  vi.stubGlobal('fetch', backend.fetch)
  const user = userEvent.setup()
  renderApp('/e/lbr/games')
  await user.click(await screen.findByRole('button', { name: 'Изменить' }))
  const form = screen.getByRole('button', { name: 'Сохранить' }).closest('form')!
  expect(await within(form).findByLabelText('Особая игра', { exact: false })).toHaveValue('smuta')
  expect(within(form).queryByRole('option', { name: 'Обычная игра' })).not.toBeInTheDocument()
})
