import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useBlocker } from 'react-router'
import { inviteLink, useItems, useNewInvite, useUpdateEvent } from '@/api/events'
import { exportUrl, useFinishEvent } from '@/api/play'
import type { EventDetail, ItemDef, SpinsRow } from '@/api/types.gen'
import { Button } from '@/components/Button'
import { buttonClass } from '@/components/buttonClass'
import { ItemIcon } from '@/components/ItemIcon'
import { Card, ErrorText, Field, Input, Loading } from '@/components/ui'
import { forgetBroken, isPictureLink, useBrokenImages } from '@/lib/brokenImages'
import { kindLabels } from '@/lib/items'
import { DEFAULT_WHEEL_SECONDS } from '@/lib/wheel'

/** The server's default for a speed record (game.DefaultRecordPoints). */
const DEFAULT_RECORD_POINTS = 5
import { useEventContext } from './context'

export function SettingsTab() {
  const { event } = useEventContext()
  const items = useItems(event.slug)

  if (!event.me?.isJudge) return <Navigate to=".." replace />
  if (items.isPending) return <Loading />
  if (items.isError && !items.data) return <ErrorText error={items.error} />
  // The form keeps its own state; it starts from the saved values of this event.
  const sections = [
    ['event', 'Ивент'], ['pool', 'Пул'], ['points', 'Очки'], ['wheels', 'Колёса'],
    ['spins', 'Крутки'], ['items', 'Предметы'], ['export', 'Экспорт и завершение'],
  ]
  return (
    <div className="flex flex-col gap-4">
      <ErrorText error={items.error} />
      <nav aria-label="Разделы настроек" className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {sections.filter(([id]) => event.status === 'active' || id === 'export').map(([id, label]) => (
          <a key={id} href={`#settings-${id}`} className="text-link underline">{label}</a>
        ))}
      </nav>
      {event.status === 'active' && <SettingsForm key={event.slug} event={event} items={items.data} />}
      <EventActions event={event} />
    </div>
  )
}

/** Export and finishing the event. */
function EventActions({ event }: { event: EventDetail }) {
  const finish = useFinishEvent(event.slug)
  return (
    <Card id="settings-export" className="flex flex-col gap-3">
      <h2 className="font-semibold">Экспорт и завершение</h2>
      <div className="flex flex-wrap gap-2">
        <a href={exportUrl(event.slug)} download className={buttonClass('secondary')}>
          Скачать экспорт (JSON)
        </a>
        {event.status === 'active' && (
          <Button
            variant="secondary"
            className="text-red-700 dark:text-red-400"
            disabled={finish.isPending}
            onClick={() => {
              if (confirm('Завершить ивент? Итоги заморозятся, больше никто не сможет крутить, вступать и менять результаты. Отменить это нельзя.'))
                finish.mutate()
            }}
          >
            Завершить ивент
          </Button>
        )}
      </div>
      <p className="text-xs text-muted">
        Экспорт — всё об ивенте одним файлом: участники, пул, ходы, журнал, итоги (без адреса вебхука). После завершения итоги заморожены и не
        меняются, даже если позже изменятся правила.
      </p>
      <ErrorText error={finish.error} />
    </Card>
  )
}

type ItemRow = { weight: number; enabled: boolean; params: Record<string, number> }

function SettingsForm({ event, items }: { event: EventDetail; items: ItemDef[] }) {
  const update = useUpdateEvent(event.slug)
  const [title, setTitle] = useState(event.title)
  const [startSpins, setStartSpins] = useState(event.settings.startSpins)
  const [rows, setRows] = useState<SpinsRow[]>(event.settings.spinsByHours)
  const [webhook, setWebhook] = useState(event.settings.webhookUrl ?? '')
  const [gameWheel, setGameWheel] = useState(event.settings.gameWheelSeconds)
  const [itemWheel, setItemWheel] = useState(event.settings.itemWheelSeconds)
  const [recordPoints, setRecordPoints] = useState(event.settings.recordPoints ?? DEFAULT_RECORD_POINTS)
  const [maxGames, setMaxGames] = useState(event.settings.maxGamesPerMember)
  const [inviteOnly, setInviteOnly] = useState(event.settings.inviteOnly)
  const [icons, setIcons] = useState<Record<string, string>>(event.settings.icons ?? {})
  // What the preview and its warning show: a link is taken once the judge leaves its field or
  // saves the form, so a half-typed link is never loaded or reported as broken.
  const [shownIcons, setShownIcons] = useState<Record<string, string>>(event.settings.icons ?? {})
  const showIcons = (ids: string[]) => {
    const taken = Object.fromEntries(ids.map((id) => [id, (icons[id] ?? '').trim()]))
    for (const link of Object.values(taken)) forgetBroken(link) // set again: try it again (the host may be back)
    setShownIcons((m) => ({ ...m, ...taken }))
  }
  /** Links typed since they were last shown: saving with Enter keeps the focus in the field, so no blur takes them. */
  const unshownIcons = () => Object.keys(icons).filter((id) => (icons[id] ?? '').trim() !== (shownIcons[id] ?? ''))
  const [itemRows, setItemRows] = useState<Record<string, ItemRow>>(() =>
    Object.fromEntries(
      items.map((it) => [it.id, { weight: it.weight, enabled: it.enabled, params: Object.fromEntries(it.params.map((p) => [p.name, p.value])) }]),
    ),
  )
  const snapshot = JSON.stringify({ title, startSpins, rows, webhook, gameWheel, itemWheel, recordPoints, maxGames, inviteOnly, icons, itemRows })
  const [savedSnapshot, setSavedSnapshot] = useState(snapshot)
  const [saved, setSaved] = useState(false)
  const dirty = snapshot !== savedSnapshot
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && (
    currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search
  ))
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const setRow = (i: number, patch: Partial<SpinsRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const setItem = (id: string, patch: Partial<ItemRow>) =>
    setItemRows((m) => ({ ...m, [id]: { ...(m[id] ?? { weight: 1, enabled: true, params: {} }), ...patch } }))
  const num = (v: string) => (v === '' ? 0 : Number(v))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (update.isPending || !dirty) return
    setSaved(false)
    const submitted = snapshot
    showIcons(unshownIcons())
    const weights: Record<string, number> = {}
    const disabled: string[] = []
    const params: Record<string, Record<string, number>> = {}
    for (const it of items) {
      const row = itemRows[it.id]
      if (!row) continue
      if (row.weight !== it.defaultWeight) weights[it.id] = row.weight
      if (!row.enabled) disabled.push(it.id)
      for (const p of it.params) {
        const v = row.params[p.name] ?? p.default
        if (v !== p.default) params[it.id] = { ...params[it.id], [p.name]: v }
      }
    }
    update.mutate(
      {
        title,
        settings: {
          startSpins,
          spinsByHours: rows,
          weights,
          disabled,
          params,
          webhookUrl: webhook,
          gameWheelSeconds: gameWheel,
          itemWheelSeconds: itemWheel,
          recordPoints,
          maxGamesPerMember: maxGames,
          inviteOnly,
          icons: Object.fromEntries(Object.entries(icons).filter(([, v]) => v.trim() !== '')),
        },
      },
      { onSuccess: () => { setSavedSnapshot(submitted); setSaved(true) } },
    )
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Card id="settings-event" className="flex flex-col gap-3">
        <h2 className="font-semibold">Ивент</h2>
        <Field label="Название">
          <Input value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Вебхук Discord" hint="Сюда придут уведомления о крутках и итогах. Видят только судьи.">
          <Input value={webhook} placeholder="https://discord.com/api/webhooks/…" onChange={(e) => setWebhook(e.target.value)} />
        </Field>
      </Card>

      <Card id="settings-pool" className="flex flex-col gap-3">
        <h2 className="font-semibold">Пул и вступление</h2>
        <Field label="Игр на участника" hint="Сколько игр каждый может добавить в пул. 0 — без ограничений. Судей не касается." className="max-w-56">
          <Input type="number" min={0} max={1000} value={maxGames} onChange={(e) => setMaxGames(num(e.target.value))} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={inviteOnly} onChange={(e) => setInviteOnly(e.target.checked)} />
          Вступление только по ссылке-приглашению
        </label>
        {event.settings.inviteOnly && event.settings.inviteCode && <InviteLink event={event} />}
        {inviteOnly && !event.settings.inviteOnly && <p className="text-xs text-muted">Ссылка появится после сохранения.</p>}
      </Card>

      <Card id="settings-points" className="flex flex-col gap-3">
        <h2 className="font-semibold">Очки</h2>
        <Field label="За рекорд скорости" hint="Самое быстрое прохождение игры среди всех участников." className="max-w-56">
          <Input type="number" min={0} max={100} value={recordPoints} onChange={(e) => setRecordPoints(num(e.target.value))} />
        </Field>
      </Card>

      <Card id="settings-wheels" className="flex flex-col gap-3">
        <h2 className="font-semibold">Длительность вращения колеса</h2>
        <p className="text-xs text-muted">В секундах, до 120. Пусто или 0 — как обычно ({String(DEFAULT_WHEEL_SECONDS).replace('.', ',')} с). Действует и на оверлей.</p>
        <div className="flex flex-wrap gap-3">
          <Field label="Колесо игр и киноколесо" className="max-w-56">
            <Input type="number" min={0} max={120} value={gameWheel || ''} onChange={(e) => setGameWheel(num(e.target.value))} />
          </Field>
          <Field label="Колёса предметов и дропов" className="max-w-56">
            <Input type="number" min={0} max={120} value={itemWheel || ''} onChange={(e) => setItemWheel(num(e.target.value))} />
          </Field>
        </div>
      </Card>

      <Card id="settings-spins" className="flex flex-col gap-3">
        <h2 className="font-semibold">Крутки колеса эффектов и бонусов</h2>
        <Field label="В начале ивента" className="max-w-40">
          <Input type="number" min={1} max={20} value={startSpins} onChange={(e) => setStartSpins(num(e.target.value))} />
        </Field>
        <div className="flex flex-col gap-2 text-sm">
          <p className="font-medium">После пройденной игры, по часам HLTB</p>
          <p className="text-xs text-muted">Работает последняя строка, где «от часов» не больше часов игры. Без строк — 1 крутка.</p>
          {rows.map((r, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <Field label="От часов" className="w-32">
                <Input type="number" min={0} value={r.minHours} onChange={(e) => setRow(i, { minHours: num(e.target.value) })} />
              </Field>
              <Field label="Круток" className="w-32">
                <Input type="number" min={0} max={20} value={r.spins} onChange={(e) => setRow(i, { spins: num(e.target.value) })} />
              </Field>
              <Button variant="secondary" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                Убрать
              </Button>
            </div>
          ))}
          <Button
            variant="secondary"
            className="self-start"
            onClick={() => setRows((rs) => [...rs, { minHours: (rs.at(-1)?.minHours ?? -10) + 10, spins: (rs.at(-1)?.spins ?? 0) + 1 }])}
          >
            Добавить строку
          </Button>
        </div>
      </Card>

      <Card id="settings-items" className="flex flex-col gap-4">
        <h2 className="font-semibold">Предметы</h2>
        <p className="text-xs text-muted">
          Вес — относительная частота на колесе. Эффекты и бонусы делят одно колесо. Иконка — ссылка на картинку; без неё показывается эмодзи.
        </p>
        <div aria-hidden="true" className="hidden gap-3 text-xs font-medium text-muted sm:grid sm:grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)_5rem]">
          <span>Вкл · Предмет</span><span>Иконка</span><span>Вес</span>
        </div>
        {Object.entries(kindLabels).map(([kind, label]) => (
          <div key={kind} className="flex flex-col gap-1">
            <h3 className="text-sm font-medium text-muted">{label}</h3>
            {items
              .filter((it) => it.kind === kind)
              .map((it) => {
                const row = itemRows[it.id] ?? { weight: it.weight, enabled: it.enabled, params: {} }
                return (
                  <div key={it.id} className="flex flex-col gap-1 text-sm">
                    {/* On a phone the name keeps its own line and the inputs wrap below it. */}
                    <div className="grid items-center gap-3 sm:grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)_5rem]">
                      <label className="flex min-w-48 flex-1 items-center gap-2">
                        <input type="checkbox" checked={row.enabled} onChange={(e) => setItem(it.id, { enabled: e.target.checked })} />
                        <ItemIcon defId={it.id} kind={it.kind} icons={shownIcons} size="sm" />
                        {it.name}
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-xs text-muted sm:hidden">Иконка</span>
                        <Input
                          type="url"
                          className="min-w-0 text-xs"
                          placeholder="иконка: https://…"
                          aria-label={`Иконка «${it.name}»`}
                          value={icons[it.id] ?? ''}
                          onChange={(e) => setIcons((m) => ({ ...m, [it.id]: e.target.value }))}
                          onBlur={() => showIcons([it.id])}
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-xs text-muted sm:hidden">Вес</span>
                        <Input
                          type="number"
                          min={0}
                          max={1000}
                          className="w-20"
                          aria-label={`Вес «${it.name}»`}
                          value={row.weight}
                          onChange={(e) => setItem(it.id, { weight: num(e.target.value) })}
                        />
                      </label>
                    </div>
                    {/* Hidden while the judge edits the link: the edit is checked when they leave the field. */}
                    {(icons[it.id] ?? '').trim() === (shownIcons[it.id] ?? '') && <IconLinkStatus url={shownIcons[it.id] ?? ''} />}
                    {it.params.map((p) => (
                      <label key={p.name} className="ml-6 flex flex-wrap items-center gap-2 text-xs text-stone-600 dark:text-stone-400">
                        <span className="flex-1">
                          {p.label} <span className="text-muted">(от {p.min} до {p.max}, обычно {p.default})</span>
                        </span>
                        <Input
                          type="number"
                          min={p.min}
                          max={p.max}
                          className="w-20"
                          value={row.params[p.name] ?? p.default}
                          onChange={(e) => setItem(it.id, { params: { ...row.params, [p.name]: num(e.target.value) } })}
                        />
                      </label>
                    ))}
                  </div>
                )
              })}
          </div>
        ))}
      </Card>

      <div className="sticky bottom-2 z-30 flex flex-col gap-2 rounded-xl border border-stone-300 bg-white p-3 shadow-lg dark:border-stone-700 dark:bg-stone-900">
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={!dirty || !title.trim() || update.isPending}>
            {update.isPending ? 'Сохранение…' : 'Сохранить'}
          </Button>
          <span role="status" className="text-sm text-muted">
            {update.isPending ? 'Сохраняем отправленные изменения…' : dirty ? 'Есть несохранённые изменения' : saved ? 'Сохранено' : 'Изменений нет'}
          </span>
        </div>
        <ErrorText error={update.error} />
        {blocker.state === 'blocked' && (
          <div role="alertdialog" aria-label="Несохранённые настройки" onKeyDown={(e) => { if (e.key === 'Escape') blocker.reset() }} className="flex flex-col gap-2">
            <p className="text-sm">Есть несохранённые изменения. Уйти без сохранения?</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" autoFocus onClick={() => blocker.reset()}>Остаться</Button>
              <Button variant="secondary" onClick={() => blocker.proceed()}>Уйти без сохранения</Button>
            </div>
          </div>
        )}
      </div>
    </form>
  )
}

/**
 * Warns when an item picture link does not load (on the board the item shows
 * its emoji then). It reads what the row's preview found out (lib/brokenImages),
 * so the picture is asked for once; the preview tries a link only after the
 * judge leaves the field, never a half-typed one.
 */
function IconLinkStatus({ url }: { url: string }) {
  const isBroken = useBrokenImages()
  if (!isPictureLink(url) || !isBroken(url)) return null
  return <p className="ml-6 text-xs text-danger">Картинка не загрузилась — на доске будет эмодзи.</p>
}

/** The invite link with copy and replace buttons. */
function InviteLink({ event }: { event: EventDetail }) {
  const renew = useNewInvite(event.slug)
  const [copied, setCopied] = useState(false)
  const link = inviteLink(event.slug, event.settings.inviteCode ?? '')
  return (
    <div className="flex flex-col gap-2 text-sm">
      <Input readOnly value={link} aria-label="Ссылка-приглашение" onFocus={(e) => e.target.select()} />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={() => {
            void navigator.clipboard?.writeText(link).then(() => setCopied(true))
          }}
        >
          {copied ? 'Скопировано' : 'Копировать'}
        </Button>
        <Button
          variant="secondary"
          disabled={renew.isPending}
          onClick={() => {
            if (confirm('Выпустить новую ссылку? Старая перестанет работать.')) renew.mutate(undefined, { onSuccess: () => setCopied(false) })
          }}
        >
          Новая ссылка
        </Button>
      </div>
      <ErrorText error={renew.error} />
    </div>
  )
}
