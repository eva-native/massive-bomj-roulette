import { Navigate, Outlet } from 'react-router'
import { useMe } from '@/api/hooks'

/** Renders child routes for logged-in users and sends everyone else to /login. */
export function RequireAuth() {
  const me = useMe()
  if (me.isPending) return <p className="p-8 text-center text-stone-500">Загрузка…</p>
  if (me.isError) return <p className="p-8 text-center text-red-600">Сервер недоступен: {me.error.message}</p>
  if (!me.data) return <Navigate to="/login" replace />
  return <Outlet />
}
