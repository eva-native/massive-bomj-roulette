import type { RouteObject } from 'react-router'
import { AppShell } from '@/components/AppShell'
import { RequireAuth } from '@/components/RequireAuth'
import { EventsPage } from '@/pages/EventsPage'
import { LoginPage } from '@/pages/LoginPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { EventLayout } from '@/pages/event/EventLayout'
import { GamesTab } from '@/pages/event/GamesTab'
import { MembersTab } from '@/pages/event/MembersTab'
import { MoviesTab } from '@/pages/event/MoviesTab'
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
              { index: true, element: <MembersTab /> },
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
