import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { FieldView, ItemView, Me, PlayTime, PlayTimeRequest, PlayerView, QueueEntry, SpinResult, StepView, TurnView } from '@/api/types.gen'
import { fakeBackend } from '@/test/fakeBackend'
import { renderApp } from '@/test/renderApp'

const judge: Me = { id: 1, name: 'Судья', avatarUrl: '', isAdmin: true }
const alice: Me = { id: 2, name: 'Алиса', avatarUrl: '', isAdmin: false }

const step = (id: number, kind: string, extra: Partial<StepView> = {}): StepView => ({
  id,
  kind,
  done: false,
  result: '',
  addedBy: '',
  options: [],
  ...extra,
})

function turn(steps: StepView[], extra: Partial<TurnView> = {}): TurnView {
  return {
    id: 10,
    number: 1,
    reason: 'start',
    steps,
    current: steps.find((s) => !s.done) ?? null,
    wheel: null,
    playthrough: null,
    items: [],
    waiting: '',
    ...extra,
  }
}

function view(t: TurnView | null, extra: Partial<PlayerView> = {}): PlayerView {
  return { player: { id: alice.id, name: alice.name, avatarUrl: '' }, canAct: true, turn: t, pocket: [], history: [], points: 0, entries: [], ...extra }
}

const opaaa: ItemView = {
  id: 50,
  defId: 'opaaa',
  name: 'ОПАААА',
  concept: 'Получи плюс 4 очка.',
  kind: 'effect',
  placement: 'pending',
  blocked: false,
  status: '',
  note: '',
  fields: [],
  needsConfirm: false,
  confirmed: false,
  rejected: false,
  locked: false,
  useLabel: '',
  canUse: false,
  useHint: '',
}

/** An event where Alice plays and the judge judges. */
function setup(me: Me) {
  const backend = fakeBackend({ me })
  backend.addEvent('lbr', 'ЛБР', judge)
  backend.setMe(alice)
  return backend
}

async function joinAs(backend: ReturnType<typeof setup>, me: Me) {
  // Alice joins through the fake API, then the test switches to `me`.
  await backend.fetch('/api/events/lbr/join', { method: 'POST' })
  backend.setMe(me)
}

describe('my turn', () => {
  it('spins the wheel, animates to the server result and shows the next step', async () => {
    const backend = setup(alice)
    await joinAs(backend, alice)
    const wheel = { kind: 'items', sectors: [{ label: 'ОПАААА', weight: 1, kind: 'effect', defId: 'opaaa' }, { label: 'Парашют', weight: 1, kind: 'bonus', defId: 'parachute' }] }
    let current = view(turn([step(11, 'spin_items'), step(12, 'spin_game'), step(13, 'play')], { wheel }))
    const after = view(turn([step(11, 'spin_items', { done: true, result: 'ОПАААА' }), step(12, 'spin_game'), step(13, 'play')], { items: [opaaa] }))
    backend.on('GET', /\/players\/2$/, () => current)
    backend.on('POST', /\/steps\/11\/spin$/, () => {
      current = after
      return { wheel, result: 0, label: 'ОПАААА', view: after } satisfies SpinResult
    })
    vi.stubGlobal('fetch', backend.fetch)
    const user = userEvent.setup()
    const { queryClient } = renderApp('/e/lbr/play')

    await user.click(await screen.findByRole('button', { name: 'Крутить' }))
    expect(await screen.findByText('Крутится…')).toBeInTheDocument()
    // A live refetch in the middle of the spin does not give the result away.
    await act(() => queryClient.invalidateQueries())
    await act(() => new Promise((r) => setTimeout(r, 50))) // let the new data render
    expect(screen.queryByText('Колесо эффектов и бонусов: ОПАААА')).not.toBeInTheDocument()
    // jsdom has no CSS animations: end the spin by hand.
    fireEvent.animationEnd(screen.getByTestId('wheel-rotor'))

    expect(await screen.findByRole('status')).toHaveTextContent('Выпало: ОПАААА')
    expect(screen.getByText('Колесо эффектов и бонусов: ОПАААА')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'ОПАААА' })).toBeInTheDocument() // the item on the game
  })

  it('sends the outcome of the game to the judge', async () => {
    const backend = setup(alice)
    await joinAs(backend, alice)
    const playing = turn([step(11, 'spin_items', { done: true }), step(12, 'spin_game', { done: true }), step(13, 'play')], {
      playthrough: { id: 70, gameId: 5, game: 'GTA San Andreas', hltbHours: 30, basePoints: 39, coverUrl: '', outcome: '', hours: 0, proof: '', review: '', confirmed: false, points: 0, timerMs: 0 },
    })
    let current = view(playing)
    backend.on('GET', /\/players\/2$/, () => current)
    backend.on('POST', /\/steps\/13\/finish$/, () => {
      current = view({ ...playing, current: null, waiting: 'Итог ждёт подтверждения судьи' })
      return current
    })
    vi.stubGlobal('fetch', backend.fetch)
    const user = userEvent.setup()
    renderApp('/e/lbr/play')

    expect(await screen.findByText('GTA San Andreas')).toBeInTheDocument()
    const send = screen.getByRole('button', { name: 'Отправить судье' })
    expect(send).toBeDisabled() // hours are required for a completed game
    // Only digits can be typed in (issue #3).
    await user.type(screen.getByLabelText('Время в игре: часы'), 'abc25ч')
    expect(screen.getByLabelText('Время в игре: часы')).toHaveValue('25')
    await user.type(screen.getByLabelText('Время в игре: минуты'), '30')
    await user.type(screen.getByLabelText('Доказательство (ссылка)'), 'https://imgur.com/x')
    expect(send).toBeDisabled() // a review is required for a completed or dropped game
    await user.click(screen.getByLabelText('Тех. дроп'))
    expect(screen.getByLabelText('Обзор (необязательно)')).toBeInTheDocument() // but not for a technical drop
    await user.click(screen.getByLabelText('Прошёл'))
    await user.type(screen.getByLabelText('Обзор'), 'Классика')
    await user.click(send)

    expect(await screen.findByText('Итог ждёт подтверждения судьи')).toBeInTheDocument()
    const post = backend.requests.find((r) => r.url.endsWith('/finish'))
    expect(post?.body).toEqual({ outcome: 'completed', hours: 25.5, proof: 'https://imgur.com/x', review: 'Классика' })
  })

  it('keeps the running session in the browser and adds it to the saved time', async () => {
    const backend = setup(alice)
    await joinAs(backend, alice)
    const playing = turn([step(11, 'spin_items', { done: true }), step(12, 'spin_game', { done: true }), step(13, 'play')], {
      playthrough: { id: 70, gameId: 5, game: 'GTA San Andreas', hltbHours: 30, basePoints: 39, coverUrl: '', outcome: '', hours: 0, proof: '', review: '', confirmed: false, points: 0, timerMs: 0 },
    })
    backend.on('GET', /\/players\/2$/, () => view(playing))
    let saved: PlayTime = { playthrough: 70, totalMs: 3600_000, canEdit: true }
    backend.on('GET', /\/players\/2\/playtime$/, () => saved)
    backend.on('POST', /\/players\/2\/playtime$/, (body) => {
      const req = body as PlayTimeRequest
      saved = { ...saved, totalMs: req.setMs ?? saved.totalMs + req.addMs }
      return saved
    })
    // A paused session from an earlier visit.
    localStorage.setItem('mbr:timer:lbr:70', JSON.stringify({ elapsedMs: (90 * 60 + 5) * 1000, startedAt: null }))
    vi.stubGlobal('fetch', backend.fetch)
    const user = userEvent.setup()
    renderApp('/e/lbr/play')

    expect(await screen.findByRole('timer')).toHaveTextContent('1:30:05')
    const panel = screen.getByRole('region', { name: 'Время в игре' })
    expect(await within(panel).findByText('2 ч 30 мин 5 с')).toBeInTheDocument() // saved hour + current session

    await user.click(screen.getByRole('button', { name: 'Взять из таймера: 2 ч 30 мин 5 с' }))
    expect(screen.getByLabelText('Время в игре: часы')).toHaveValue('2')
    expect(screen.getByLabelText('Время в игре: минуты')).toHaveValue('30')
    expect(screen.getByLabelText('Время в игре: секунды')).toHaveValue('5')

    await user.click(screen.getByRole('button', { name: 'Сохранить сессию' }))
    expect(await screen.findByRole('timer')).toHaveTextContent('0:00:00')
    expect(backend.requests.find((r) => r.method === 'POST' && r.url.endsWith('/playtime'))?.body).toEqual({ addMs: 5405_000, setMs: null })
    expect(localStorage.getItem('mbr:timer:lbr:70')).toBeNull()
    expect(within(panel).getByText('Сохранено:').parentElement).toHaveTextContent('2 ч 30 мин 5 с')

    // The saved total can be corrected.
    await user.click(within(panel).getAllByRole('button', { name: 'Изменить' })[1]!)
    const hours = within(panel).getByLabelText('Сохранено: часы')
    await user.clear(hours)
    await user.type(hours, '3')
    await user.click(within(panel).getByRole('button', { name: 'Сохранить' }))
    await vi.waitFor(() => expect(within(panel).getByText('Сохранено:').parentElement).toHaveTextContent('3 ч 30 мин 5 с'))
    expect(backend.requests.filter((r) => r.url.endsWith('/playtime') && r.method === 'POST').at(-1)?.body).toEqual({ addMs: 0, setMs: 12605_000 })
  })



  it('locks item fields once they are sent to the judge', async () => {
    const backend = setup(alice)
    await joinAs(backend, alice)
    const wonField: FieldView = { name: 'won', label: 'Победа', type: 'bool', by: 'player', optional: false, value: null }
    const duel: ItemView = {
      ...opaaa,
      id: 51,
      defId: 'sto_k_odnomu',
      name: '100 к 1',
      concept: 'Вызови человека на поединок.',
      needsConfirm: true,
      fields: [wonField],
    }
    const playing = (it: ItemView) =>
      view(turn([step(11, 'spin_items', { done: true }), step(12, 'spin_game', { done: true }), step(13, 'play')], { items: [it] }))
    let current = playing(duel)
    backend.on('GET', /\/players\/2$/, () => current)
    backend.on('POST', /\/items\/51\/input$/, () => {
      current = playing({ ...duel, locked: true, fields: [{ ...wonField, value: true }] })
      return undefined
    })
    vi.stubGlobal('fetch', backend.fetch)
    const user = userEvent.setup()
    renderApp('/e/lbr/play')

    const card = (await screen.findByRole('heading', { name: '100 к 1' })).closest('article')!
    await user.click(within(card).getByRole('checkbox', { name: 'Победа' }))
    await user.click(within(card).getByRole('button', { name: 'Отправить результат' }))

    expect(await within(card).findByText(/Отправлено судье/)).toBeInTheDocument()
    expect(within(card).getByRole('checkbox', { name: 'Победа' })).toBeDisabled()
    expect(within(card).queryByRole('button', { name: 'Отправить результат' })).not.toBeInTheDocument()
  })
})

describe('judge queue', () => {
  it('confirms a finished game', async () => {
    const backend = setup(judge)
    backend.setMe(judge)
    const entry: QueueEntry = {
      kind: 'playthrough',
      id: 70,
      player: { id: 2, name: 'Алиса', avatarUrl: '' },
      title: 'GTA San Andreas',
      playthrough: { id: 70, gameId: 5, game: 'GTA San Andreas', hltbHours: 30, basePoints: 39, coverUrl: '', outcome: 'completed', hours: 25, proof: 'https://imgur.com/x', review: '', confirmed: false, points: 0, timerMs: 0 },
      item: null,
      game: 'GTA San Andreas',
    }
    let queue = [entry]
    backend.on('GET', /\/queue$/, () => queue)
    backend.on('POST', /\/playthroughs\/70\/confirm$/, () => {
      queue = []
      return undefined
    })
    vi.stubGlobal('fetch', backend.fetch)
    const user = userEvent.setup()
    renderApp('/e/lbr/judge')

    const card = (await screen.findByText(/прошёл «GTA San Andreas» за 25 ч/)).closest('section')!
    expect(within(card).getByRole('link', { name: 'https://imgur.com/x' })).toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: 'Подтвердить' }))

    expect(await screen.findByText('Всё подтверждено, очередь пуста.')).toBeInTheDocument()
    expect(backend.requests.find((r) => r.url.endsWith('/confirm'))?.body).toEqual({ accept: true })
  })
})

describe('rule text', () => {
  it('turns markdown links into links and keeps the rest as text', async () => {
    const { render } = await import('@testing-library/react')
    const { RuleText } = await import('@/components/RuleText')
    render(<RuleText text={'Во время игры слушай [полный плейлист](https://youtube.com/x).\nВторая строка'} />)
    expect(screen.getByRole('link', { name: 'полный плейлист' })).toHaveAttribute('href', 'https://youtube.com/x')
    expect(screen.getByText(/Вторая строка/)).toBeInTheDocument()
  })
})
