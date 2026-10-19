import { useState, type FormEvent } from 'react'
import { Navigate, useSearchParams } from 'react-router'
import { useAppConfig, useDevLogin, useMe } from '@/api/hooks'
import { Button } from '@/components/Button'
import { buttonClass } from '@/components/buttonClass'

export function LoginPage() {
  const me = useMe()
  const config = useAppConfig()
  const [params] = useSearchParams()

  // Only same-site paths, never a full URL from the query.
  const next = params.get('next') ?? '/'
  if (me.data) return <Navigate to={next.startsWith('/') && !next.startsWith('//') ? next : '/'} replace />

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <div className="text-center">
        <h1 className="text-3xl font-bold">MBR</h1>
        <p className="mt-1 text-stone-500">Massive Bomj Roulette</p>
      </div>

      {params.get('error') === 'discord' && (
        <p role="alert" className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          Не удалось войти через Discord. Попробуйте ещё раз.
        </p>
      )}

      {config.data?.discordLogin && (
        <a href="/auth/discord/login" className={buttonClass('discord', 'w-full')}>
          Войти через Discord
        </a>
      )}

      {config.data?.devLogin && <DevLoginForm />}
    </main>
  )
}

function DevLoginForm() {
  const [name, setName] = useState('')
  const login = useDevLogin()

  const submit = (e: FormEvent) => {
    e.preventDefault()
    login.mutate({ name })
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 rounded-lg border border-dashed border-stone-300 p-4 dark:border-stone-700">
      <label htmlFor="dev-name" className="text-sm font-medium">
        Вход для разработки
      </label>
      <input
        id="dev-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Имя"
        maxLength={32}
        className="rounded-lg border border-stone-300 bg-transparent px-3 py-2 text-sm dark:border-stone-700"
      />
      {login.error && <p className="text-sm text-red-600">{login.error.message}</p>}
      <Button type="submit" variant="secondary" disabled={!name.trim() || login.isPending}>
        Войти как «{name.trim() || '…'}»
      </Button>
    </form>
  )
}
