import { act, fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ActivityEntry, EventDetail, Me } from '@/api/types.gen'
import { fakeBackend } from '@/test/fakeBackend'
import { renderApp } from '@/test/renderApp'

const judge: Me = { id: 1, name: 'Судья', avatarUrl: '', isAdmin: true }

const spinEntry = (id: number, label: string): ActivityEntry => ({
  id,
  kind: 'spin',
  message: `Алиса крутит колесо игр: ${label}`,
  actorName: 'Алиса',
  createdAt: '2026-10-19T10:00:00Z',
  spin: { player: 'Алиса', wheel: { kind: 'games', sectors: [{ label: 'GTA', weight: 1, kind: '', defId: '' }, { label: label, weight: 1, kind: '', defId: '' }] }, result: 1, label },
})

describe('OBS overlay', () => {
  it('is public, skips old spins and replays new ones', async () => {
    const backend = fakeBackend()
    backend.addEvent('lbr', 'ЛБР', judge)
    let activity: ActivityEntry[] = [spinEntry(1, 'Старая игра')]
    backend.on('GET', /\/activity/, () => activity)
    backend.on('GET', /\/leaderboard$/, () => [{ player: { id: 2, name: 'Алиса', avatarUrl: '' }, points: 49, completed: 1, dropped: 0, playing: '' }])
    vi.stubGlobal('fetch', backend.fetch)
    const { queryClient } = renderApp('/e/lbr/overlay')

    expect(await screen.findByText('49')).toBeInTheDocument() // the leaderboard, no login needed
    expect(screen.getByText('Алиса крутит колесо игр: Старая игра')).toBeInTheDocument()
    expect(screen.queryByTestId('wheel-rotor')).not.toBeInTheDocument() // the old spin is not replayed
    expect(document.documentElement).toHaveClass('overlay')

    // A new spin arrives (the live stream would trigger this refetch).
    activity = [spinEntry(2, 'Celeste'), ...activity]
    await act(() => queryClient.invalidateQueries())
    const rotor = await screen.findByTestId('wheel-rotor')
    // The OBS scenes are laid out for this size: the overlay's wheel stays 320 px.
    expect(screen.getByRole('img', { name: 'Колесо игр, 2 сектора' }).parentElement).toHaveClass('max-w-80')
    expect(screen.queryByText('Celeste', { selector: 'p' })).not.toBeInTheDocument() // result only after the stop
    fireEvent.animationEnd(rotor)
    expect(await screen.findByText('Celeste', { selector: 'p' })).toBeInTheDocument()
  })

  it("draws the judge's item pictures on the wheel, without the ticker", async () => {
    const backend = fakeBackend()
    backend.addEvent('lbr', 'ЛБР', judge)
    const detail = (await (await backend.fetch('/api/events/lbr')).json()) as EventDetail
    const icon = 'https://example.com/opaaa.png'
    backend.on('GET', /^\/api\/events\/lbr$/, () => ({ ...detail, settings: { ...detail.settings, icons: { opaaa: icon } } }))
    // 37 items: on the overlay's 320 px wheel they show as icons.
    const sectors = Array.from({ length: 37 }, (_, i) => ({ label: `Эффект ${i}`, weight: 1, kind: 'effect', defId: i === 0 ? 'opaaa' : `x${i}` }))
    let activity: ActivityEntry[] = []
    backend.on('GET', /\/activity/, () => activity)
    vi.stubGlobal('fetch', backend.fetch)
    const { queryClient } = renderApp('/e/lbr/overlay')
    // The overlay replays only spins newer than the feed it opened with: let that feed load first.
    await vi.waitFor(() => expect(backend.requests.some((r) => r.url.includes('/activity'))).toBe(true))
    await act(() => new Promise((r) => setTimeout(r, 20)))

    activity =[{ ...spinEntry(2, 'Эффект 0'), spin: { player: 'Алиса', wheel: { kind: 'items', sectors }, result: 0, label: 'Эффект 0' } }]
    await act(() => queryClient.invalidateQueries())
    const rotor = await screen.findByTestId('wheel-rotor')
    expect(rotor.querySelector('image')).toHaveAttribute('href', icon)
    expect(screen.queryByTestId('wheel-ticker')).not.toBeInTheDocument()
  })
})
