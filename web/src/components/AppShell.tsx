import { Link, Outlet } from 'react-router'
import { useLogout, useMe } from '@/api/hooks'
import { Button } from './Button'
import { Avatar } from './ui'

/** The page frame for logged-in users: header with the user and logout. */
export function AppShell() {
  const { data: me } = useMe()
  const logout = useLogout()

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <header className="mb-6 flex items-center justify-between gap-4">
        <Link to="/" className="text-xl font-bold">
          MBR
        </Link>
        {me && (
          <div className="flex items-center gap-3">
            <Avatar name={me.name} url={me.avatarUrl} size="sm" />
            <span className="text-sm font-medium">{me.name}</span>
            <Button variant="secondary" onClick={() => logout.mutate()} disabled={logout.isPending}>
              Выйти
            </Button>
          </div>
        )}
      </header>
      <Outlet />
    </div>
  )
}
