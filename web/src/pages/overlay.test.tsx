import { act, fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ActivityEntry, Me } from '@/api/types.gen'
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
})
