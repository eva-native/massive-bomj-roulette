import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ItemView, Me, PlayerView, QueueEntry, SpinResult, StepView, TurnView } from '@/api/types.gen'
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
    const wheel = { kind: 'items', sectors: [{ label: 'ОПАААА', weight: 1, kind: 'effect' }, { label: 'Парашют', weight: 1, kind: 'bonus' }] }
    let current = view(turn([step(11, 'spin_items'), step(12, 'spin_game'), step(13, 'play')], { wheel }))
    const after = view(turn([step(11, 'spin_items', { done: true, result: 'ОПАААА' }), step(12, 'spin_game'), step(13, 'play')], { items: [opaaa] }))
    backend.on('GET', /\/players\/2$/, () => current)
    backend.on('POST', /\/steps\/11\/spin$/, () => {
      current = after
      return { wheel, result: 0, label: 'ОПАААА', view: after } satisfies SpinResult
    })
    vi.stubGlobal('fetch', backend.fetch)
    const user = userEvent.setup()
    renderApp('/e/lbr/play')

    await user.click(await screen.findByRole('button', { name: 'Крутить' }))
    expect(await screen.findByText('Крутится…')).toBeInTheDocument()
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
      playthrough: { id: 70, gameId: 5, game: 'GTA San Andreas', hltbHours: 30, basePoints: 39, outcome: '', hours: 0, proof: '', confirmed: false, points: 0 },
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
    await user.type(screen.getByLabelText('Часов в игре'), '25,5')
    await user.type(screen.getByLabelText('Доказательство (ссылка)'), 'https://imgur.com/x')
    await user.click(send)

    expect(await screen.findByText('Итог ждёт подтверждения судьи')).toBeInTheDocument()
    const post = backend.requests.find((r) => r.url.endsWith('/finish'))
    expect(post?.body).toEqual({ outcome: 'completed', hours: 25.5, proof: 'https://imgur.com/x' })
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
      playthrough: { id: 70, gameId: 5, game: 'GTA San Andreas', hltbHours: 30, basePoints: 39, outcome: 'completed', hours: 25, proof: 'https://imgur.com/x', confirmed: false, points: 0 },
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
