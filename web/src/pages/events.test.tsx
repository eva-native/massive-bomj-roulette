import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { EventDetail, ItemDef, Me } from '@/api/types.gen'
import { fakeBackend } from '@/test/fakeBackend'
import { renderApp } from '@/test/renderApp'

const admin: Me = { id: 1, name: 'Админ', avatarUrl: '', isAdmin: true }
const alice: Me = { id: 2, name: 'Алиса', avatarUrl: '', isAdmin: false }

const items: ItemDef[] = [
  {
    id: 'opaaa', name: 'ОПАААА', concept: 'Получи плюс 4 очка.', kind: 'effect', defaultWeight: 1, weight: 1, enabled: true, specialGames: [],
    params: [{ name: 'points', label: 'Очки', default: 4, min: -100, max: 100, value: 4 }],
  },
  { id: 'parachute', name: 'Парашют', concept: 'За дроп игры не теряешь очки.', kind: 'bonus', defaultWeight: 1, weight: 1, enabled: true, specialGames: [], params: [] },
]

describe('events', () => {
  it('lets an admin create an event and become its judge', async () => {
    const backend = fakeBackend({ me: admin })
    vi.stubGlobal('fetch', backend.fetch)
    const user = userEvent.setup()
    renderApp('/')

    expect(await screen.findByText('Ивентов пока нет.')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Название'), 'ЛБР Осень')
    expect(screen.getByLabelText('Адрес')).toHaveValue('lbr-osen') // suggested from the title
    await user.click(screen.getByRole('button', { name: 'Создать' }))

    expect(await screen.findByRole('heading', { name: 'ЛБР Осень' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Настройки' })).toBeInTheDocument() // judges see settings
  })

  it('hides event creation from non-admins', async () => {
    vi.stubGlobal('fetch', fakeBackend({ me: alice }).fetch)
    renderApp('/')
    await screen.findByText('Ивентов пока нет.')
    expect(screen.queryByRole('button', { name: 'Создать' })).not.toBeInTheDocument()
  })

  it('lets a player join and add a game; others cannot edit it', async () => {
    const backend = fakeBackend({ me: alice, items })
    backend.addEvent('lbr', 'ЛБР', admin, {
      games: [{ id: 7, title: 'Чужая игра', hltbHours: 10, rating: 80, year: 2015, specialKey: '', basePoints: 17, addedBy: 99, addedByName: 'Боб', coverUrl: '' }],
    })
    vi.stubGlobal('fetch', backend.fetch)
    const user = userEvent.setup()
    renderApp('/e/lbr/games')

    expect(await screen.findByText('Чужая игра')).toBeInTheDocument()
    expect(screen.queryByText('Добавить игру')).not.toBeInTheDocument() // not a member yet
    await user.click(screen.getByRole('button', { name: 'Участвовать' }))

    expect(await screen.findByText('Добавить игру')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Изменить' })).not.toBeInTheDocument() // Bob's game

    await user.type(screen.getByLabelText('Название'), 'GTA San Andreas')
    const hours = screen.getByLabelText('Часы HLTB')
    await user.clear(hours)
    await user.type(hours, '30')
    await user.click(screen.getByRole('button', { name: 'Добавить' }))

    const row = (await screen.findByText('GTA San Andreas')).closest('li')!
    expect(within(row).getByRole('button', { name: 'Изменить' })).toBeInTheDocument()
    const post = backend.requests.find((r) => r.method === 'POST' && r.url.endsWith('/games'))
    expect(post?.body).toMatchObject({ title: 'GTA San Andreas', hltbHours: 30 })
  })

  it('joins an invite-only event only with the link', async () => {
    const backend = fakeBackend({ me: alice, items })
    backend.addEvent('lbr', 'ЛБР', admin)
    const ev = (await (await backend.fetch('/api/events/lbr')).json()) as EventDetail
    await backend.fetch('/api/events/lbr', { method: 'PATCH', body: JSON.stringify({ settings: { ...ev.settings, inviteOnly: true } }) })
    vi.stubGlobal('fetch', backend.fetch)
    const user = userEvent.setup()

    const { router } = renderApp('/e/lbr')
    expect(await screen.findByText('Вступление по ссылке-приглашению')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Участвовать' })).not.toBeInTheDocument()

    await router.navigate('/e/lbr?invite=abc')
    await user.click(await screen.findByRole('button', { name: 'Участвовать' }))
    await vi.waitFor(() => expect(backend.requests.some((r) => r.url === '/api/events/lbr/join?invite=abc')).toBe(true))
  })

  it('saves item weights and switches from the settings tab', async () => {
    const backend = fakeBackend({ me: admin, items })
    backend.addEvent('lbr', 'ЛБР', admin)
    vi.stubGlobal('fetch', backend.fetch)
    const user = userEvent.setup()
    renderApp('/e/lbr/settings')

    const weight = await screen.findByLabelText('Вес «ОПАААА»')
    await user.clear(weight)
    await user.type(weight, '5')
    const points = screen.getByLabelText(/^Очки/)
    await user.clear(points)
    await user.type(points, '5')
    await user.click(screen.getByRole('checkbox', { name: 'Парашют' }))
    await user.click(screen.getByRole('button', { name: 'Добавить строку' }))
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(await screen.findByText('Сохранено')).toBeInTheDocument()
    const patch = backend.requests.find((r) => r.method === 'PATCH')
    expect(patch?.body).toMatchObject({
      settings: {
        startSpins: 3,
        weights: { opaaa: 5 },
        disabled: ['parachute'],
        params: { opaaa: { points: 5 } },
        spinsByHours: [{ minHours: 0, spins: 1 }],
      },
    })
  })
})

describe('finishing an event', () => {
  it('asks first and posts the finish', async () => {
    const backend = fakeBackend({ me: admin, items })
    backend.addEvent('lbr', 'ЛБР', admin)
    backend.on('POST', /\/finish$/, () => undefined)
    vi.stubGlobal('fetch', backend.fetch)
    const ask = vi.fn(() => true)
    vi.stubGlobal('confirm', ask)
    const user = userEvent.setup()
    renderApp('/e/lbr/settings')

    expect(await screen.findByRole('link', { name: 'Скачать экспорт (JSON)' })).toHaveAttribute('href', '/api/events/lbr/export')
    await user.click(screen.getByRole('button', { name: 'Завершить ивент' }))
    expect(ask).toHaveBeenCalled()
    expect(backend.requests.some((r) => r.method === 'POST' && r.url === '/api/events/lbr/finish')).toBe(true)
  })
})
