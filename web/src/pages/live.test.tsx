import { act, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STREAM_DOWN_NOTICE_MS } from '@/api/play'
import type { Me } from '@/api/types.gen'
import { fakeBackend } from '@/test/fakeBackend'
import { FakeEventSource } from '@/test/fakeEventSource'
import { renderApp } from '@/test/renderApp'

const judge: Me = { id: 1, name: 'Судья', avatarUrl: '', isAdmin: true }

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}

async function openEvent() {
  const backend = fakeBackend({ me: judge })
  backend.addEvent('osen', 'ЛБР Осень', judge)
  vi.stubGlobal('fetch', backend.fetch)
  vi.stubGlobal('EventSource', FakeEventSource)
  renderApp('/e/osen')
  expect(await screen.findByRole('heading', { name: 'ЛБР Осень' })).toBeInTheDocument()
  const boardFetches = () => backend.requests.filter((r) => r.url === '/api/events/osen/leaderboard').length
  await waitFor(() => expect(boardFetches()).toBe(1))
  return { backend, es: FakeEventSource.last(), boardFetches }
}

beforeEach(() => {
  FakeEventSource.all = []
})

afterEach(() => {
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
    await new Promise((r) => setTimeout(r, 20))
    expect(boardFetches()).toBe(1)

    act(() => {
      es.fail()
      es.open()
    })
    await waitFor(() => expect(boardFetches()).toBe(2))
  })

  it('refetches when the tab comes back while the stream is down', async () => {
    const { es, boardFetches } = await openEvent()
    act(() => es.open())
    setVisibility('visible') // the stream is up: nothing to catch up on
    await new Promise((r) => setTimeout(r, 20))
    expect(boardFetches()).toBe(1)

    act(() => es.fail())
    act(() => setVisibility('visible'))
    await waitFor(() => expect(boardFetches()).toBe(2))
  })

  it('says so when the stream stays down, and clears it on reconnect', async () => {
    const { es } = await openEvent()
    act(() => es.open())
    vi.useFakeTimers()
    try {
      act(() => es.fail())
      act(() => vi.advanceTimersByTime(STREAM_DOWN_NOTICE_MS - 100)) // a normal reconnect: no notice yet
      expect(screen.queryByText(/Нет связи с сервером/)).not.toBeInTheDocument()

      act(() => vi.advanceTimersByTime(200))
      expect(screen.getByRole('status')).toHaveTextContent('Нет связи с сервером, переподключаемся…')

      act(() => es.open())
      expect(screen.queryByText(/Нет связи с сервером/)).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('asks to reload when the browser gives up on the stream', async () => {
    const { es } = await openEvent()
    act(() => es.open())
    act(() => es.fail(true))
    expect(screen.getByRole('status')).toHaveTextContent('Обновите страницу')
  })
})
