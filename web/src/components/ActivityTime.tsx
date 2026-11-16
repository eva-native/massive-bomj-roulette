import { useEffect, useState } from 'react'

const full = new Intl.DateTimeFormat('ru', { dateStyle: 'medium', timeStyle: 'short' })
const relative = new Intl.RelativeTimeFormat('ru', { numeric: 'always' })

export function ActivityTime({ at }: { at: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  const date = new Date(at)
  if (!Number.isFinite(date.getTime())) return <span className="text-xs text-muted">Дата неизвестна</span>
  const age = Math.max(0, now - date.getTime())
  const text = age < 60_000 ? 'только что' : age < 3600_000 ? relative.format(-Math.floor(age / 60_000), 'minute') : age < 86400_000 ? relative.format(-Math.floor(age / 3600_000), 'hour') : full.format(date)
  return <time dateTime={date.toISOString()} title={full.format(date)} className="text-xs text-muted">{text}</time>
}
