import type { ReactNode } from 'react'
import { Link, Outlet, useLocation, useMatch } from 'react-router'
import { useEvent } from '@/api/events'
import { useLogout, useMe } from '@/api/hooks'
import { Button } from './Button'
import { buttonClass } from './buttonClass'
import { ScrollToBottom } from './ScrollToBottom'
import { Avatar } from './ui'

/** The page frame: header with the user and logout, or a login link. */
export function AppShell() {
  const { data: me, isPending } = useMe()
  const logout = useLogout()
  const location = useLocation()

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <header className="mb-6 flex items-center justify-between gap-4">
        <Link to="/" className="text-xl font-bold">
          MBR
        </Link>
        {me ? (
          <div className="flex min-w-0 items-center gap-3">
            <ProfileLink>
              <Avatar name={me.name} url={me.avatarUrl} size="sm" />
              <span className="hidden truncate text-sm font-medium sm:inline">{me.name}</span>
            </ProfileLink>
            <Button variant="secondary" onClick={() => logout.mutate()} disabled={logout.isPending}>
              Выйти
            </Button>
          </div>
        ) : (
          !isPending && (
            <Link to={`/login?next=${encodeURIComponent(location.pathname)}`} className={buttonClass('primary')}>
              Войти
            </Link>
          )
        )}
      </header>
      <Outlet />
      <ScrollToBottom />
    </div>
  )
}

/** Inside an event where the user plays, the name leads to their own board. */
function ProfileLink({ children }: { children: ReactNode }) {
  const slug = useMatch('/e/:slug/*')?.params.slug
  const { data: event } = useEvent(slug ?? '', Boolean(slug)) // shares the cache with the event page
  const className = 'flex min-w-0 items-center gap-3'
  if (!slug || !event?.me?.isParticipant) return <span className={className}>{children}</span>
  return (
    <Link to={`/e/${slug}/play`} className={`${className} hover:underline`} title="Мой ход">
      {children}
    </Link>
  )
}
