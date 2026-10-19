import { Link } from 'react-router'

export function NotFoundPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-bold">Страница не найдена</h1>
      <Link to="/" className="text-amber-600 underline">
        На главную
      </Link>
    </main>
  )
}
