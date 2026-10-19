import type { RouteObject } from 'react-router'
import { AppShell } from '@/components/AppShell'
import { RequireAuth } from '@/components/RequireAuth'
import { EventsPage } from '@/pages/EventsPage'
import { LoginPage } from '@/pages/LoginPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
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
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: '/', element: <EventsPage /> },
          {
            path: '/e/:slug',
            element: <EventLayout />,
            children: [
              { index: true, element: <BoardTab /> },
              { path: 'play', element: <PlayTab /> },
              { path: 'judge', element: <JudgeTab /> },
              { path: 'players/:userId', element: <PlayerPage /> },
              { path: 'members', element: <MembersTab /> },
              { path: 'games', element: <GamesTab /> },
              { path: 'movies', element: <MoviesTab /> },
              { path: 'rules', element: <RulesTab /> },
              { path: 'settings', element: <SettingsTab /> },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]
