import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { EventDetail, ItemDef, Me } from '@/api/types.gen'
import { fakeBackend } from '@/test/fakeBackend'
import { RULES_URL } from '@/lib/links'
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

  it('links participants in the members tab to their boards (issue #11)', async () => {
    const backend = fakeBackend({ me: alice, items })
    backend.addEvent('lbr', 'ЛБР', admin)
    vi.stubGlobal('fetch', backend.fetch)
    const user = userEvent.setup()
    renderApp('/e/lbr/members')

    await user.click(await screen.findByRole('button', { name: 'Участвовать' }))
    expect(await screen.findByRole('link', { name: 'Алиса' })).toHaveAttribute('href', '/e/lbr/players/2')
    // A judge only, with no board: the name is plain text.
    expect(screen.getByText('Админ')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Админ' })).not.toBeInTheDocument()
  })

  it('links a former player who is still on the leaderboard', async () => {
    const backend = fakeBackend({ me: alice, items })
    backend.addEvent('lbr', 'ЛБР', admin)
    // The judge played some turns and then stopped being a participant.
    backend.on('GET', /\/leaderboard$/, () => [{ player: { id: admin.id, name: admin.name, avatarUrl: '' }, points: 12, completed: 1, dropped: 0, playing: '' }])
    vi.stubGlobal('fetch', backend.fetch)
    renderApp('/e/lbr/members')

    expect(await screen.findByRole('link', { name: 'Админ' })).toHaveAttribute('href', '/e/lbr/players/1')
  })

  it('links to the rules on GitHub (issue #11)', async () => {
    const backend = fakeBackend({ me: alice, items })
    backend.addEvent('lbr', 'ЛБР', admin)
    vi.stubGlobal('fetch', backend.fetch)
    renderApp('/e/lbr/rules')

    expect(await screen.findByRole('link', { name: 'Правила ↗' })).toHaveAttribute('href', RULES_URL)
    expect(await screen.findByRole('link', { name: 'общих правилах ивента' })).toHaveAttribute('href', RULES_URL)
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

describe('item pictures in the settings', () => {
  const gone = 'https://example.com/gone.png'
  const warning = () => screen.queryByText(/Картинка не загрузилась/)
  const pictures = (src: string) => Array.from(document.querySelectorAll('img')).filter((img) => img.getAttribute('src') === src)

  async function openSettings(savedIcons: Record<string, string> = {}) {
    const backend = fakeBackend({ me: admin, items })
    backend.addEvent('lbr', 'ЛБР', admin)
    const detail = (await (await backend.fetch('/api/events/lbr')).json()) as EventDetail
    await backend.fetch('/api/events/lbr', { method: 'PATCH', body: JSON.stringify({ settings: { ...detail.settings, icons: savedIcons } }) })
    vi.stubGlobal('fetch', backend.fetch)
    const user = userEvent.setup()
    renderApp('/e/lbr/settings')
    const field = await screen.findByLabelText('Иконка «ОПАААА»')
    return { user, field }
  }

  it('loads nothing while the judge types, and checks the link once they leave the field', async () => {
    const { user, field } = await openSettings()
    await user.type(field, gone)
    expect(document.querySelector('img')).toBeNull() // no request for "h", "ht", "htt"…

    await user.tab()
    const [preview] = pictures(gone)
    expect(preview).toBeDefined()
    expect(warning()).not.toBeInTheDocument() // not known yet
    fireEvent.error(preview!)
    expect(warning()).toBeInTheDocument()
  })

  it('gives no warning for a link that loads', async () => {
    const { user, field } = await openSettings()
    await user.type(field, 'https://example.com/fine.png')
    await user.tab()
    fireEvent.load(pictures('https://example.com/fine.png')[0]!)
    expect(warning()).not.toBeInTheDocument()
  })

  it('drops the warning while the link is edited, until the new one is checked', async () => {
    const { user, field } = await openSettings({ opaaa: gone })
    fireEvent.error(pictures(gone)[0]!)
    expect(warning()).toBeInTheDocument()

    await user.type(field, '2')
    expect(warning()).not.toBeInTheDocument()
    await user.tab()
    expect(warning()).not.toBeInTheDocument() // gone.png2 is not known to be broken
  })

  it('tries a link again when the judge sets it again (the host may be back)', async () => {
    const { user, field } = await openSettings({ opaaa: gone })
    fireEvent.error(pictures(gone)[0]!)
    expect(pictures(gone)).toHaveLength(0)

    await user.clear(field)
    await user.type(field, gone)
    await user.tab()
    expect(pictures(gone)).toHaveLength(1)
    expect(warning()).not.toBeInTheDocument()
  })

  it('asks for a saved picture once, not twice', async () => {
    await openSettings({ opaaa: 'https://example.com/opaaa.png' })
    expect(pictures('https://example.com/opaaa.png')).toHaveLength(1)
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
