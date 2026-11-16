import { act, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STREAM_DOWN_NOTICE_MS, STREAM_REOPEN_FIRST_MS, STREAM_REOPEN_NOTICE_AFTER } from '@/api/play'
import type { ActivityEntry, Me } from '@/api/types.gen'
import { fakeBackend } from '@/test/fakeBackend'
import { FakeEventSource } from '@/test/fakeEventSource'
import { renderApp } from '@/test/renderApp'

const judge: Me = { id: 1, name: 'Судья', avatarUrl: '', isAdmin: true }

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}

const tick = () => new Promise((r) => setTimeout(r, 20))
const notice = () => screen.queryByText(/Нет связи с сервером/)

async function openEvent() {
  const backend = fakeBackend({ me: judge })
  backend.addEvent('osen', 'ЛБР Осень', judge)
  backend.addEvent('zima', 'ЛБР Зима', judge)
  vi.stubGlobal('fetch', backend.fetch)
  vi.stubGlobal('EventSource', FakeEventSource)
  const { router } = renderApp('/e/osen')
  expect(await screen.findByRole('heading', { name: 'ЛБР Осень' })).toBeInTheDocument()
  const boardFetches = () => backend.requests.filter((r) => r.url === '/api/events/osen/leaderboard').length
  await waitFor(() => expect(boardFetches()).toBe(1))
  return { router, es: FakeEventSource.last(), boardFetches }
}

beforeEach(() => {
  FakeEventSource.all = []
})

afterEach(() => {
  vi.useRealTimers()
  delete (document as { visibilityState?: unknown }).visibilityState
})

describe('live stream', () => {
  it('refetches on a server message', async () => {
    const { es, boardFetches } = await openEvent()
    act(() => es.open())
    act(() => es.send())
    await waitFor(() => expect(boardFetches()).toBe(2))
  })

  it('refetches after a reconnect, not after the first connect', async () => {
    const { es, boardFetches } = await openEvent()
    act(() => es.open())
    await tick()
    expect(boardFetches()).toBe(1)

    act(() => {
      es.fail()
      es.open()
    })
    await waitFor(() => expect(boardFetches()).toBe(2))
  })

  it('refetches when the stream first opens after failing to connect', async () => {
    const { es, boardFetches } = await openEvent()
    act(() => es.fail()) // the page has its data, but the stream could not connect yet
    act(() => es.open())
    await waitFor(() => expect(boardFetches()).toBe(2))
  })

  it('fetches nothing while the stream is down, even when the tab comes back', async () => {
    const { es, boardFetches } = await openEvent()
    act(() => {
      es.open()
      es.fail()
    })
    act(() => setVisibility('visible'))
    await tick()
    expect(boardFetches()).toBe(1)
    expect(screen.getByRole('heading', { name: 'ЛБР Осень' })).toBeInTheDocument()
  })

  it('says so when the stream stays down, not during a normal reconnect', async () => {
    const { es } = await openEvent()
    act(() => es.open())
    vi.useFakeTimers()
    act(() => es.fail())
    act(() => vi.advanceTimersByTime(STREAM_DOWN_NOTICE_MS - 100)) // the browser retries after 3 s
    expect(notice()).not.toBeInTheDocument()

    act(() => vi.advanceTimersByTime(200))
    expect(screen.getByRole('status')).toHaveTextContent('Нет связи с сервером, переподключаемся…')

    act(() => es.open())
    expect(notice()).not.toBeInTheDocument()
  })

  it('opens a new stream when the browser gives up on it', async () => {
    const { es, boardFetches } = await openEvent()
    act(() => es.open())
    vi.useFakeTimers()
    act(() => es.fail(true))
    expect(FakeEventSource.all).toHaveLength(1)

    act(() => vi.advanceTimersByTime(STREAM_REOPEN_FIRST_MS))
    expect(FakeEventSource.all).toHaveLength(2)
    expect(es.readyState).toBe(FakeEventSource.CLOSED)

    vi.useRealTimers()
    act(() => FakeEventSource.last().open())
    await waitFor(() => expect(boardFetches()).toBe(2))
    expect(notice()).not.toBeInTheDocument()
  })

  it('asks to reload only after reopening keeps failing', async () => {
    const { es } = await openEvent()
    act(() => es.open())
    vi.useFakeTimers()
    for (let i = 1; i < STREAM_REOPEN_NOTICE_AFTER; i++) {
      act(() => FakeEventSource.last().fail(true))
      act(() => vi.advanceTimersByTime(60_000))
      expect(screen.queryByText(/обновите страницу/)).not.toBeInTheDocument()
    }
    act(() => FakeEventSource.last().fail(true))
    expect(screen.getByRole('status')).toHaveTextContent('обновите страницу')
  })

  it('does not carry the notice over to another event', async () => {
    const { es, router } = await openEvent()
    act(() => es.open())
    vi.useFakeTimers()
    act(() => es.fail())
    act(() => vi.advanceTimersByTime(STREAM_DOWN_NOTICE_MS))
    expect(notice()).toBeInTheDocument()

    vi.useRealTimers()
    await act(() => router.navigate('/e/zima'))
    expect(await screen.findByRole('heading', { name: 'ЛБР Зима' })).toBeInTheDocument()
    expect(notice()).not.toBeInTheDocument()
  })
})

describe('overlay', () => {
  const spin = (id: number, player: string): ActivityEntry => ({
    id,
    kind: 'spin',
    message: `${player} крутит колесо игр: Mario`,
    actorName: player,
    createdAt: new Date().toISOString(),
    spin: { player, wheel: { kind: 'games', sectors: [{ label: 'Mario', weight: 1, kind: '', defId: '' }] }, result: 0, label: 'Mario' },
  })

  it('does not replay spins missed while the stream was down, but plays new ones', async () => {
    const backend = fakeBackend()
    backend.addEvent('osen', 'ЛБР Осень', judge)
    let activity: ActivityEntry[] = []
    backend.on('GET', /\/activity/, () => activity)
    const feedFetches = () => backend.requests.filter((r) => r.url.includes('/activity')).length
    vi.stubGlobal('fetch', backend.fetch)
    vi.stubGlobal('EventSource', FakeEventSource)
    renderApp('/e/osen/overlay')
    await waitFor(() => expect(feedFetches()).toBe(1))
    const es = FakeEventSource.last()
    act(() => es.open())

    act(() => es.fail())
    activity = [spin(5, 'Боб')] // made while the overlay was offline
    act(() => es.open())
    await waitFor(() => expect(feedFetches()).toBe(2))
    await tick()
    expect(screen.getByText('Боб крутит колесо игр: Mario')).toBeInTheDocument() // the feed has it
    expect(screen.queryByText('Боб: Колесо игр')).not.toBeInTheDocument() // the wheel does not replay it

    activity = [spin(6, 'Алиса'), ...activity]
    act(() => es.send())
    expect(await screen.findByText('Алиса: Колесо игр')).toBeInTheDocument()
  })
})
