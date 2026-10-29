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
    expect(screen.queryByText('Уже выпало: ОПАААА')).not.toBeInTheDocument()
    // jsdom has no CSS animations: end the spin by hand.
    fireEvent.animationEnd(screen.getByTestId('wheel-rotor'))

    expect(await screen.findByText('Выпало: ОПАААА')).toHaveRole('status') // the page has another status region: the connection notice
    expect(screen.getByText('Уже выпало: ОПАААА')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'ОПАААА' })).toBeInTheDocument() // the item on the game
  })

  it('puts the spin button right under the wheel and says the spin is on its way', async () => {
    const backend = setup(alice)
    await joinAs(backend, alice)
    const wheel = { kind: 'items', sectors: [{ label: 'ОПАААА', weight: 1, kind: 'effect', defId: 'opaaa' }, { label: 'Парашют', weight: 1, kind: 'bonus', defId: 'parachute' }] }
    const current = view(turn([step(11, 'spin_items'), step(12, 'spin_game'), step(13, 'play')], { wheel }))
    backend.on('GET', /\/players\/2$/, () => current)
    backend.on('POST', /\/steps\/11\/spin$/, () => ({ wheel, result: 0, label: 'ОПАААА', view: current }) satisfies SpinResult)
    let answer = () => {}
    const answered = new Promise<void>((r) => (answer = r))
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/spin')) await answered // the server is slow to answer
      return backend.fetch(input, init)
    })
    const user = userEvent.setup()
    renderApp('/e/lbr/play')

    const button = await screen.findByRole('button', { name: 'Крутить' })
    expect(screen.getByTestId('wheel-rotor').compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // The board's wheel is the big one (the overlay keeps 320 px, see overlay.test.tsx).
    expect(screen.getByRole('img', { name: /^Колесо эффектов и бонусов/ }).parentElement).toHaveClass('max-w-[560px]')
    await user.click(button)
    expect(screen.getByRole('button', { name: 'Крутим…' })).toBeDisabled()

    answer()
    expect(await screen.findByText('Крутится…')).toBeInTheDocument()
  })

  it('lays the board out with the items on the game beside it, before the form on a narrow screen', async () => {
    const backend = setup(alice)
    await joinAs(backend, alice)
    const playing = turn([step(11, 'spin_items', { done: true }), step(12, 'spin_game', { done: true }), step(13, 'play')], {
      playthrough: { id: 70, gameId: 5, game: 'GTA San Andreas', hltbHours: 30, basePoints: 39, coverUrl: '', outcome: '', hours: 0, proof: '', review: '', confirmed: false, points: 0, timerMs: 0 },
      items: [opaaa],
    })
    backend.on('GET', /\/players\/2$/, () => view(playing, { pocket: [{ ...opaaa, id: 51, name: 'Парашют', kind: 'bonus', placement: 'pocket' }] }))
    vi.stubGlobal('fetch', backend.fetch)
    const { router } = renderApp('/e/lbr/play')

    const game = await screen.findByText('GTA San Andreas')
    // The nearest ancestor with an order-N class (not "border-…", which contains "order-").
    const block = (el: Element) => {
      let at: Element | null = el
      while (at && ![...at.classList].some((c) => /^order-\d$/.test(c))) at = at.parentElement
      return at!
    }
    // One column below 1024 px: game, the items on it, the form, the pocket.
    expect(block(game)).toHaveClass('order-1')
    expect(block(screen.getByRole('heading', { name: 'Действует на «GTA San Andreas»' }))).toHaveClass('order-2')
    expect(block(screen.getByRole('button', { name: 'Отправить судье' }))).toHaveClass('order-3')
    expect(block(screen.getByRole('heading', { name: 'Карман' }))).toHaveClass('order-4')
    // The board takes a wider page; other tabs keep theirs.
    expect(document.querySelector('.max-w-6xl')).not.toBeNull()
    await act(() => router.navigate('/e/lbr/games'))
    expect(document.querySelector('.max-w-6xl')).toBeNull()
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
    await user.type(screen.getByLabelText('Время прохождения: часы'), 'abc25ч')
    expect(screen.getByLabelText('Время прохождения: часы')).toHaveValue('25')
    await user.type(screen.getByLabelText('Время прохождения: минуты'), '30')
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
    const panel = screen.getByRole('region', { name: 'Время' })
    // One name per number: the session over the clock, the saved time, and the two added up.
    expect(within(panel).getByText('Текущая сессия')).toBeInTheDocument()
    expect(await within(panel).findByText('Итого по игре:')).toBeInTheDocument()
    expect(within(panel).getByText('Итого по игре:').parentElement).toHaveTextContent('2 ч 30 мин 5 с') // saved hour + current session

    await user.click(screen.getByRole('button', { name: 'Подставить итого: 2 ч 30 мин 5 с' }))
    expect(screen.getByLabelText('Время прохождения: часы')).toHaveValue('2')
    expect(screen.getByLabelText('Время прохождения: минуты')).toHaveValue('30')
    expect(screen.getByLabelText('Время прохождения: секунды')).toHaveValue('5')

    await user.click(screen.getByRole('button', { name: 'Сохранить сессию' }))
    expect(await screen.findByRole('timer')).toHaveTextContent('0:00:00')
    expect(backend.requests.find((r) => r.method === 'POST' && r.url.endsWith('/playtime'))?.body).toEqual({ addMs: 5405_000, setMs: null })
    expect(localStorage.getItem('mbr:timer:lbr:70')).toBeNull()
    expect(within(panel).getByText('Сохранено:').parentElement).toHaveTextContent('2 ч 30 мин 5 с')

    // The saved total can be corrected.
    await user.click(within(panel).getByRole('button', { name: 'Изменить сохранённое' }))
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
    // Sent: the answer is shown as text, not as a box that cannot be ticked.
    expect(within(card).queryByRole('checkbox')).not.toBeInTheDocument()
    expect(card).toHaveTextContent('Победа: да')
    expect(within(card).queryByRole('button', { name: 'Отправить результат' })).not.toBeInTheDocument()
  })

  // The server reads the owner's unticked box as «no»; the form must not send
  // it, or a judge's save would answer for the player (issue #11).
  it('does not send an untouched yes/no field', async () => {
    const backend = setup(alice)
    await joinAs(backend, alice)
    const rps: ItemView = {
      ...opaaa,
      id: 52,
      defId: 'rps',
      name: 'Решим это по-мужски',
      concept: 'Камень, ножницы, бумага.',
      needsConfirm: true,
      fields: [{ name: 'won', label: 'Победа', type: 'bool', by: 'player', optional: false, value: null }],
    }
    backend.on('GET', /\/players\/2$/, () =>
      view(turn([step(11, 'spin_items', { done: true }), step(12, 'spin_game', { done: true }), step(13, 'play')], { items: [rps] })),
    )
    backend.on('POST', /\/items\/52\/input$/, () => undefined)
    vi.stubGlobal('fetch', backend.fetch)
    const user = userEvent.setup()
    renderApp('/e/lbr/play')

    const card = (await screen.findByRole('heading', { name: 'Решим это по-мужски' })).closest('article')!
    await user.click(within(card).getByRole('button', { name: 'Отправить результат' }))

    await vi.waitFor(() => expect(backend.requests.find((r) => r.url.endsWith('/items/52/input'))?.body).toEqual({ values: {} }))
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

describe('pocket', () => {
  const parachute = (id: number, extra: Partial<ItemView> = {}): ItemView => ({
    ...opaaa,
    id,
    defId: 'parachute',
    name: 'Парашют',
    kind: 'bonus',
    placement: 'pocket',
    useLabel: 'Применить к игре',
    canUse: true,
    ...extra,
  })

  async function openPocket(pocket: ItemView[]) {
    const backend = setup(alice)
    await joinAs(backend, alice)
    backend.on('GET', /\/players\/2$/, () => view(turn([step(11, 'spin_items')]), { pocket }))
    backend.on('POST', /\/items\/\d+\/use$/, () => view(turn([step(11, 'spin_items')]), { pocket }))
    vi.stubGlobal('fetch', backend.fetch)
    renderApp('/e/lbr/play')
    await screen.findByRole('heading', { name: 'Карман' })
    return backend
  }

  it('shows identical bonuses once, ×3, and uses the first of them', async () => {
    const backend = await openPocket([parachute(61), parachute(62), parachute(63)])
    expect(screen.getAllByRole('heading', { name: 'Парашют' })).toHaveLength(1)
    expect(screen.getByText('×3')).toBeInTheDocument()

    await userEvent.setup().click(screen.getByRole('button', { name: 'Применить к игре' }))
    await vi.waitFor(() => expect(backend.requests.some((r) => r.url.endsWith('/items/61/use'))).toBe(true))
  })

  it('keeps apart bonuses that differ: another item, or one with something filled in', async () => {
    const helper: FieldView = { name: 'helper', label: 'Помощник', type: 'player', by: 'player', optional: false, value: 3 }
    await openPocket([parachute(61), parachute(62, { fields: [helper] }), { ...parachute(63), defId: 'reroll', name: 'Реролл' }])
    expect(screen.getAllByRole('heading', { name: 'Парашют' })).toHaveLength(2)
    expect(screen.queryByText(/^×/)).not.toBeInTheDocument()
  })

  it('says once why nothing in the pocket can be used now', async () => {
    const hint = 'сейчас нельзя: на этой игре бонусы запрещены («Самодостаточный»)'
    await openPocket([parachute(61, { canUse: false, useHint: hint }), { ...parachute(62, { canUse: false, useHint: hint }), defId: 'reroll', name: 'Реролл', useLabel: 'Перекрутить' }])
    expect(screen.getByText(`Применить бонусы из кармана ${hint}`)).toBeInTheDocument()
    expect(screen.getAllByText(new RegExp(hint.replace(/[()«»]/g, '.')))).toHaveLength(1) // not repeated under each card
  })
})

describe('item fields', () => {
  const bob: Me = { id: 3, name: 'Боб', avatarUrl: '', isAdmin: false }
  const whose: FieldView = { name: 'target', label: 'Чью игру судим', type: 'player', by: 'player', optional: false, value: 2 }
  const verdict: FieldView = { name: 'verdict', label: 'Решение судьи', type: 'text', by: 'judge', optional: false, value: null }
  const lawsuit: ItemView = { ...opaaa, id: 54, defId: 'lawsuit', name: 'Геймерский Иск', kind: 'bonus', placement: 'used', fields: [whose, verdict] }
  const helper: FieldView = { name: 'helper', label: 'Помощник', type: 'player', by: 'player', optional: false, value: null }
  const friend: ItemView = { ...opaaa, id: 55, defId: 'friend_assist', name: 'Френд-ассистед', kind: 'bonus', placement: 'pocket', fields: [helper] }

  async function openBoard(viewer: Me) {
    const backend = setup(viewer)
    await joinAs(backend, viewer)
    backend.on('GET', /\/players\/2$/, () => view(turn([step(11, 'spin_items')], { items: [lawsuit] }), { pocket: [friend], canAct: false }))
    vi.stubGlobal('fetch', backend.fetch)
    renderApp('/e/lbr/players/2')
    return (await screen.findByRole('heading', { name: 'Геймерский Иск' })).closest('article')!
  }

  it('shows another player what was filled in as text, not as a form', async () => {
    const card = await openBoard(bob)
    expect(card).toHaveTextContent('Чью игру судим: Алиса')
    expect(card).toHaveTextContent('Решение судьи: заполнит судья')
    expect(within(card).queryByRole('combobox')).not.toBeInTheDocument()
    expect(within(card).queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('leaves out an empty field of a bonus in the pocket', async () => {
    await openBoard(bob)
    const pocketCard = screen.getByRole('heading', { name: 'Френд-ассистед' }).closest('article')!
    expect(pocketCard).not.toHaveTextContent('Помощник')
  })

  it('shows what the player fills in meanwhile, keeping what the judge is typing', async () => {
    const levels: FieldView = { name: 'levels', label: 'Пройдено уровней', type: 'int', by: 'player', optional: false, value: 5 }
    const dendy: ItemView = { ...opaaa, id: 56, defId: 'dendy', name: 'А вы помните денди?', fields: [levels, verdict] }
    const backend = setup(judge)
    await joinAs(backend, judge)
    let current = dendy
    backend.on('GET', /\/players\/2$/, () => view(turn([step(11, 'spin_items')], { items: [current] }), { canAct: false }))
    vi.stubGlobal('fetch', backend.fetch)
    const user = userEvent.setup()
    const { queryClient } = renderApp('/e/lbr/players/2')

    const card = (await screen.findByRole('heading', { name: 'А вы помните денди?' })).closest('article')!
    expect(within(card).getByRole('spinbutton')).toHaveValue(5)
    await user.type(within(card).getByRole('textbox'), 'Засчитано')

    current = { ...dendy, fields: [{ ...levels, value: 7 }, verdict] } // the player changed the levels
    await act(() => queryClient.invalidateQueries())
    await vi.waitFor(() => expect(within(card).getByRole('spinbutton')).toHaveValue(7))
    expect(within(card).getByRole('textbox')).toHaveValue('Засчитано')
  })

  it('keeps what the judge types while a save is on its way', async () => {
    const levels: FieldView = { name: 'levels', label: 'Пройдено уровней', type: 'int', by: 'player', optional: false, value: 5 }
    const dendy: ItemView = { ...opaaa, id: 56, defId: 'dendy', name: 'А вы помните денди?', fields: [levels, verdict] }
    const backend = setup(judge)
    await joinAs(backend, judge)
    let current = dendy
    backend.on('GET', /\/players\/2$/, () => view(turn([step(11, 'spin_items')], { items: [current] }), { canAct: false }))
    backend.on('POST', /\/items\/56\/input$/, () => {
      current = { ...dendy, fields: [levels, { ...verdict, value: 'Засчитано' }] }
      return undefined
    })
    let answer = () => {}
    const answered = new Promise<void>((r) => (answer = r))
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/input')) await answered // a slow save
      return backend.fetch(input, init)
    })
    const user = userEvent.setup()
    renderApp('/e/lbr/players/2')

    const card = (await screen.findByRole('heading', { name: 'А вы помните денди?' })).closest('article')!
    await user.type(within(card).getByRole('textbox'), 'Засчитано')
    await user.click(within(card).getByRole('button', { name: 'Сохранить' }))
    await user.clear(within(card).getByRole('spinbutton'))
    await user.type(within(card).getByRole('spinbutton'), '9') // typed while the save runs
    answer()

    await vi.waitFor(() => expect(backend.requests.some((r) => r.url.endsWith('/items/56/input'))).toBe(true))
    await act(() => new Promise((r) => setTimeout(r, 50)))
    expect(within(card).getByRole('spinbutton')).toHaveValue(9)
    expect(within(card).getByRole('textbox')).toHaveValue('Засчитано') // from the server now
  })

  it('marks what waits on the board of a judge who plays', async () => {
    const backend = setup(judge)
    await joinAs(backend, judge)
    const dendy: ItemView = { ...opaaa, id: 59, defId: 'dendy', name: 'А вы помните денди?', needsConfirm: true, fields: [{ name: 'levels', label: 'Пройдено уровней', type: 'int', by: 'player', optional: false, value: null }] }
    backend.on('GET', /\/players\/1$/, () => view(turn([step(11, 'spin_items')], { items: [dendy] }), { player: { id: judge.id, name: judge.name, avatarUrl: '' } }))
    vi.stubGlobal('fetch', backend.fetch)
    renderApp('/e/lbr/players/1')

    const card = (await screen.findByRole('heading', { name: 'А вы помните денди?' })).closest('article')!
    expect(within(card).getByText('Нужно действие')).toBeInTheDocument()
  })

  it("marks the judge's field for the judge, without «(судья)» after its name", async () => {
    const card = await openBoard(judge)
    expect(within(card).getByRole('textbox', { name: /^Решение судьи\W+заполняет судья$/ })).toBeInTheDocument()
    expect(card).not.toHaveTextContent('(судья)')
  })
})

describe('steps of the turn', () => {
  it('show spins in a row as one chip with the count, the results under them', async () => {
    const backend = setup(alice)
    await joinAs(backend, alice)
    const wheel = { kind: 'items', sectors: [{ label: 'ОПАААА', weight: 1, kind: 'effect', defId: 'opaaa' }] }
    const steps = [
      step(11, 'spin_items', { done: true, result: 'ОПАААА' }),
      step(12, 'spin_items'),
      step(13, 'spin_items'),
      step(14, 'spin_game', { addedBy: 'Внезапный ДЭБ' }),
      step(15, 'play'),
    ]
    backend.on('GET', /\/players\/2$/, () => view(turn(steps, { wheel })))
    vi.stubGlobal('fetch', backend.fetch)
    renderApp('/e/lbr/play')

    const chips = (await screen.findAllByRole('listitem')).map((li) => li.textContent)
    expect(chips).toEqual(['Эффекты и бонусы · 2 из 3', 'Колесо игр · от «Внезапный ДЭБ»', 'Прохождение'])
    expect(screen.getByText('Уже выпало: ОПАААА')).toBeInTheDocument()
    expect(screen.getByText('Крутка 2 из 3 · колесо эффектов и бонусов')).toBeInTheDocument()
  })

  it('show a started group as started while the turn waits for the judge, not as one ahead', async () => {
    const backend = setup(alice)
    await joinAs(backend, alice)
    const steps = [step(11, 'spin_items', { done: true, result: 'ОПАААА' }), step(12, 'spin_items'), step(13, 'spin_items'), step(14, 'play')]
    // An item waits for the judge in the middle of the spins: no current step.
    backend.on('GET', /\/players\/2$/, () => view(turn(steps, { current: null, waiting: 'Ждём решения судьи' })))
    vi.stubGlobal('fetch', backend.fetch)
    renderApp('/e/lbr/play')

    const [started, ahead] = await screen.findAllByRole('listitem')
    expect(started).toHaveTextContent('Эффекты и бонусы · 1 из 3')
    expect(started).not.toHaveClass('border-dashed')
    expect(ahead).toHaveTextContent('Прохождение')
    expect(ahead).toHaveClass('border-dashed')
  })
})

describe('items on the game', () => {
  it('put the one waiting for the player first, marked, and show drop debuffs in red', async () => {
    const backend = setup(alice)
    await joinAs(backend, alice)
    const dendy: ItemView = {
      ...opaaa,
      id: 57,
      defId: 'dendy',
      name: 'А вы помните денди?',
      needsConfirm: true,
      fields: [{ name: 'levels', label: 'Пройдено уровней', type: 'int', by: 'player', optional: false, value: null }],
    }
    const scary: ItemView = { ...opaaa, id: 58, defId: 'scary', name: 'Очень страшная игра', kind: 'drop', placement: 'attached' }
    backend.on('GET', /\/players\/2$/, () => view(turn([step(11, 'spin_items')], { items: [opaaa, scary, dendy] })))
    vi.stubGlobal('fetch', backend.fetch)
    renderApp('/e/lbr/play')

    // No game chosen yet: the section says what was spun, not what works on a game.
    await screen.findByRole('heading', { name: 'Выпало в этом ходу' })
    // By kind (effects, then drop debuffs), the waiting one first among the effects.
    expect(screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual([
      'Эффекты',
      'А вы помните денди?',
      'ОПАААА',
      'Дроп-дебаффы',
      'Очень страшная игра',
    ])
    const waiting = screen.getByRole('heading', { name: 'А вы помните денди?' }).closest('article')!
    expect(within(waiting).getByText('Нужно действие')).toBeInTheDocument()
    expect(screen.getAllByText('Нужно действие')).toHaveLength(1)
    expect(screen.getByText('дроп-дебафф')).toHaveClass('bg-red-100')
  })
})

describe('blocked items', () => {
  it('stay readable: a badge and a dashed border mark them, not transparency', async () => {
    const backend = setup(alice)
    await joinAs(backend, alice)
    const blocked = { ...opaaa, blocked: true }
    backend.on('GET', /\/players\/2$/, () => view(turn([step(11, 'spin_items', { done: true }), step(12, 'spin_game')], { items: [blocked] })))
    vi.stubGlobal('fetch', backend.fetch)
    renderApp('/e/lbr/play')

    const card = (await screen.findByRole('heading', { name: 'ОПАААА' })).closest('article')!
    expect(within(card).getByText('заблокирован')).toBeInTheDocument()
    expect(card).toHaveClass('border-dashed')
    expect(card.className).not.toMatch(/opacity-/)
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
