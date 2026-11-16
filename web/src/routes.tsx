import type { RouteObject } from 'react-router'
import { AppShell } from '@/components/AppShell'
import { EventsPage } from '@/pages/EventsPage'
import { LoginPage } from '@/pages/LoginPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { OverlayPage } from '@/pages/OverlayPage'
import { BoardTab } from '@/pages/event/BoardTab'
import { EventLayout } from '@/pages/event/EventLayout'
import { GamesTab } from '@/pages/event/GamesTab'
import { JudgeTab } from '@/pages/event/JudgeTab'
import { MembersTab } from '@/pages/event/MembersTab'
import { MoviesTab } from '@/pages/event/MoviesTab'
import { PlayerPage, PlayTab } from '@/pages/event/PlayTab'
import { RulesTab } from '@/pages/event/RulesTab'
import { SettingsTab } from '@/pages/event/SettingsTab'

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  // The OBS overlay: no frame, transparent, public.
  { path: '/e/:slug/overlay', element: <OverlayPage /> },
  {
    // Everything is readable without logging in; actions need a login and
    // the server checks every right.
    element: <AppShell />,
    children: [
          { path: '/', element: <EventsPage /> },
          {
            path: '/e/:slug',
            element: <EventLayout />,
            children: [
              { index: true, element: <BoardTab /> },
              // Boards take a wider page for their two columns (see AppShell).
              { path: 'play', element: <PlayTab />, handle: { wide: true } },
              { path: 'judge', element: <JudgeTab /> },
              { path: 'players/:userId', element: <PlayerPage />, handle: { wide: true } },
              { path: 'members', element: <MembersTab /> },
              { path: 'games', element: <GamesTab /> },
              { path: 'movies', element: <MoviesTab /> },
              { path: 'rules', element: <RulesTab /> },
              { path: 'settings', element: <SettingsTab /> },
            ],
          },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]
