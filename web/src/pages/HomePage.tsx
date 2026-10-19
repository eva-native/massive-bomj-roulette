import { useLogout, useMe } from '@/api/hooks'
import { Button } from '@/components/Button'

export function HomePage() {
  const { data: me } = useMe()
  const logout = useLogout()
  if (!me) return null

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {me.avatarUrl ? (
            <img src={me.avatarUrl} alt="" className="size-10 rounded-full" />
          ) : (
            <div className="flex size-10 items-center justify-center rounded-full bg-amber-500 font-bold text-stone-950">
              {me.name.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div>
            <p className="font-medium">Привет, {me.name}!</p>
            {me.isAdmin && <p className="text-xs text-stone-500">Администратор</p>}
          </div>
        </div>
        <Button variant="secondary" onClick={() => logout.mutate()} disabled={logout.isPending}>
          Выйти
        </Button>
      </header>

      <p className="mt-12 text-center text-stone-500">Ивенты появятся на следующих этапах.</p>
    </main>
  )
}
