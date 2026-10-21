import { vi } from 'vitest'
import type {
  AppConfig,
  EventDetail,
  EventSettings,
  Game,
  GameInput,
  ItemDef,
  Me,
  Movie,
} from '@/api/types.gen'

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

type FakeEvent = { detail: EventDetail; games: Game[]; movies: Movie[] }

/**
 * An in-memory imitation of the MBR API, just enough for page tests.
 * `requests` records every call so tests can check what was sent.
 */
export function fakeBackend(opts: { config?: AppConfig; me?: Me | null; items?: ItemDef[] } = {}) {
  const config = opts.config ?? { discordLogin: false, devLogin: true }
  const items = opts.items ?? []
  let me: Me | null = opts.me ?? null
  let nextId = 100
  const events = new Map<string, FakeEvent>()
  const requests: { method: string; url: string; body?: unknown }[] = []
  const overrides: { method: string; path: RegExp; handle: (body: unknown) => unknown }[] = []

  const membership = (ev: EventDetail) => ev.members.find((m) => m.userId === me?.id)
  const withMe = (ev: EventDetail): EventDetail => {
    const m = membership(ev)
    return { ...ev, me: m ? { isParticipant: m.isParticipant, isJudge: m.isJudge } : null }
  }

  const backend = {
    requests,
    /** Answers method + path with handle(body) as JSON 200 (204 for undefined), before the built-in routes. */
    on(method: string, path: RegExp, handle: (body: unknown) => unknown) {
      overrides.unshift({ method, path, handle })
    },
    setMe(user: Me | null) {
      me = user
    },
    addEvent(slug: string, title: string, judge: Me, extra: Partial<FakeEvent> = {}) {
      const settings: EventSettings = { startSpins: 3, spinsByHours: [], weights: {}, disabled: [], params: {}, gameWheelSeconds: 0, itemWheelSeconds: 0 }
      events.set(slug, {
        detail: {
          slug,
          title,
          status: 'active',
          settings,
          members: [{ userId: judge.id, name: judge.name, avatarUrl: '', isParticipant: false, isJudge: true }],
          me: null,
        },
        games: extra.games ?? [],
        movies: extra.movies ?? [],
      })
    },
    fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      requests.push({ method, url, body })

      for (const o of overrides) {
        if (o.method === method && o.path.test(url)) {
          const out = o.handle(body)
          return out === undefined ? new Response(null, { status: 204 }) : json(200, out)
        }
      }

      if (url === '/api/config') return json(200, config)
      if (url === '/api/me') return me ? json(200, me) : json(401, { error: 'not logged in' })
      if (url === '/auth/dev/login') {
        me = { id: nextId++, name: body.name, avatarUrl: '', isAdmin: false }
        return json(200, me)
      }
      if (url === '/auth/logout') {
        me = null
        return new Response(null, { status: 204 })
      }

      if (url === '/api/events' && method === 'GET') {
        return json(
          200,
          [...events.values()].map(({ detail }) => ({
            slug: detail.slug,
            title: detail.title,
            status: detail.status,
            participants: detail.members.filter((m) => m.isParticipant).length,
            isParticipant: membership(detail)?.isParticipant ?? false,
            isJudge: membership(detail)?.isJudge ?? false,
          })),
        )
      }
      if (url === '/api/events' && method === 'POST') {
        if (!me?.isAdmin) return json(403, { error: 'нет прав' })
        backend.addEvent(body.slug, body.title, me)
        return json(201, withMe(events.get(body.slug)!.detail))
      }

      const m = url.match(/^\/api\/events\/([^/]+)(?:\/(\w+))?(?:\/(\d+))?$/)
      const ev = m && events.get(decodeURIComponent(m[1]!))
      if (!m || !ev) return json(404, { error: 'не найдено' })
      const [, , sub, id] = m

      if (!sub && method === 'GET') return json(200, withMe(ev.detail))
      if (!sub && method === 'PATCH') {
        if (body.title) ev.detail.title = body.title
        if (body.settings) ev.detail.settings = body.settings
        return json(200, withMe(ev.detail))
      }
      if (sub === 'join') {
        const existing = membership(ev.detail)
        if (existing) existing.isParticipant = true
        else ev.detail.members.push({ userId: me!.id, name: me!.name, avatarUrl: '', isParticipant: true, isJudge: false })
        return json(200, withMe(ev.detail))
      }
      if (sub === 'items') {
        return json(
          200,
          items.map((it) => ({
            ...it,
            weight: ev.detail.settings.weights[it.id] ?? it.defaultWeight,
            enabled: !ev.detail.settings.disabled.includes(it.id),
          })),
        )
      }
      if (sub === 'games' && method === 'GET') return json(200, ev.games)
      if (sub === 'games' && method === 'POST') {
        const input = body as GameInput
        const g: Game = { id: nextId++, ...input, basePoints: input.hltbHours, addedBy: me!.id, addedByName: me!.name }
        ev.games.push(g)
        return json(201, g)
      }
      if (sub === 'games' && id && method === 'DELETE') {
        ev.games = ev.games.filter((g) => g.id !== Number(id))
        return new Response(null, { status: 204 })
      }
      if (sub === 'movies' && method === 'GET') return json(200, ev.movies)
      return json(404, { error: 'не найдено' })
    }),
  }
  return backend
}
