import { Link, Outlet, useLocation } from 'react-router'
import { useLogout, useMe } from '@/api/hooks'
import { Button } from './Button'
import { buttonClass } from './buttonClass'
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
            <Avatar name={me.name} url={me.avatarUrl} size="sm" />
            <span className="hidden truncate text-sm font-medium sm:inline">{me.name}</span>
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
    </div>
  )
}
