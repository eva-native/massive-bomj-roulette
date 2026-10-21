import { useEffect, useState } from 'react'

/**
 * The stopwatch of the current play session. It lives in this browser only
 * (localStorage), so a pause survives reloads and closed tabs; finished
 * sessions are saved on the server as play sessions.
 */
type Stored = { elapsedMs: number; startedAt: number | null }

const empty: Stored = { elapsedMs: 0, startedAt: null }

export function timerKey(slug: string, playthroughId: number) {
  return `mbr:timer:${slug}:${playthroughId}`
}

function load(key: string): Stored {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return empty
    const v = JSON.parse(raw) as Partial<Stored>
    return {
      elapsedMs: typeof v.elapsedMs === 'number' && v.elapsedMs > 0 ? v.elapsedMs : 0,
      startedAt: typeof v.startedAt === 'number' ? v.startedAt : null,
    }
  } catch {
    return empty
  }
}

function store(key: string, v: Stored) {
  try {
    if (v.elapsedMs === 0 && v.startedAt === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(v))
  } catch {
    // Storage may be blocked (private mode); the timer still works until reload.
  }
}

export type LocalTimer = {
  ms: number
  running: boolean
  start: () => void
  pause: () => void
  /** Sets the time of the current session, keeping it running if it was. */
  set: (ms: number) => void
  reset: () => void
}

export function useLocalTimer(key: string): LocalTimer {
  const [state, setState] = useState<Stored>(() => load(key))
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => store(key, state), [key, state])
  useEffect(() => {
    if (state.startedAt === null) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [state.startedAt])

  const elapsed = (s: Stored, at: number) => s.elapsedMs + (s.startedAt === null ? 0 : Math.max(0, at - s.startedAt))
  return {
    ms: elapsed(state, now),
    running: state.startedAt !== null,
    start: () => {
      const at = Date.now()
      setNow(at)
      setState((s) => (s.startedAt === null ? { ...s, startedAt: at } : s))
    },
    pause: () => {
      const at = Date.now()
      setNow(at)
      setState((s) => ({ elapsedMs: elapsed(s, at), startedAt: null }))
    },
    set: (ms) => {
      const at = Date.now()
      setNow(at)
      setState((s) => ({ elapsedMs: Math.max(0, ms), startedAt: s.startedAt === null ? null : at }))
    },
    reset: () => setState(empty),
  }
}
