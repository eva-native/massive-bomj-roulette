import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router'
import { useItems, useUpdateEvent } from '@/api/events'
import { exportUrl, useFinishEvent } from '@/api/play'
import type { EventDetail, ItemDef, SpinsRow } from '@/api/types.gen'
import { Button } from '@/components/Button'
import { buttonClass } from '@/components/buttonClass'
import { Card, ErrorText, Field, Input, Loading } from '@/components/ui'
import { kindLabels } from '@/lib/items'
import { DEFAULT_WHEEL_SECONDS } from '@/lib/wheel'
import { useEventContext } from './context'

export function SettingsTab() {
  const { event } = useEventContext()
  const items = useItems(event.slug)

  if (!event.me?.isJudge) return <Navigate to=".." replace />
  if (items.isPending) return <Loading />
  if (items.isError) return <ErrorText error={items.error} />
  // The form keeps its own state; it starts from the saved values of this event.
  return (
    <div className="flex flex-col gap-4">
      {event.status === 'active' && <SettingsForm key={event.slug} event={event} items={items.data} />}
      <EventActions event={event} />
    </div>
  )
}

/** Export and finishing the event. */
function EventActions({ event }: { event: EventDetail }) {
  const finish = useFinishEvent(event.slug)
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="font-semibold">Ивент целиком</h2>
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
      <p className="text-xs text-stone-500">
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
  const [itemRows, setItemRows] = useState<Record<string, ItemRow>>(() =>
    Object.fromEntries(
      items.map((it) => [it.id, { weight: it.weight, enabled: it.enabled, params: Object.fromEntries(it.params.map((p) => [p.name, p.value])) }]),
    ),
  )
  const [saved, setSaved] = useState(false)

  const setRow = (i: number, patch: Partial<SpinsRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const setItem = (id: string, patch: Partial<ItemRow>) =>
    setItemRows((m) => ({ ...m, [id]: { ...(m[id] ?? { weight: 1, enabled: true, params: {} }), ...patch } }))
  const num = (v: string) => (v === '' ? 0 : Number(v))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setSaved(false)
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
        },
      },
      { onSuccess: () => setSaved(true) },
    )
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3">
        <h2 className="font-semibold">Ивент</h2>
        <Field label="Название">
          <Input value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Вебхук Discord" hint="Сюда придут уведомления о крутках и итогах. Видят только судьи.">
          <Input value={webhook} placeholder="https://discord.com/api/webhooks/…" onChange={(e) => setWebhook(e.target.value)} />
        </Field>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="font-semibold">Длительность вращения колеса</h2>
        <p className="text-xs text-stone-500">В секундах, до 120. Пусто или 0 — как обычно ({String(DEFAULT_WHEEL_SECONDS).replace('.', ',')} с). Действует и на оверлей.</p>
        <div className="flex flex-wrap gap-3">
          <Field label="Колесо игр и киноколесо" className="max-w-56">
            <Input type="number" min={0} max={120} value={gameWheel || ''} onChange={(e) => setGameWheel(num(e.target.value))} />
          </Field>
          <Field label="Колёса предметов и дропов" className="max-w-56">
            <Input type="number" min={0} max={120} value={itemWheel || ''} onChange={(e) => setItemWheel(num(e.target.value))} />
          </Field>
        </div>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="font-semibold">Крутки колеса эффектов и бонусов</h2>
        <Field label="В начале ивента" className="max-w-40">
          <Input type="number" min={1} max={20} value={startSpins} onChange={(e) => setStartSpins(num(e.target.value))} />
        </Field>
        <div className="flex flex-col gap-2 text-sm">
          <p className="font-medium">После пройденной игры, по часам HLTB</p>
          <p className="text-xs text-stone-500">Работает последняя строка, где «от часов» не больше часов игры. Без строк — 1 крутка.</p>
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

      <Card className="flex flex-col gap-4">
        <h2 className="font-semibold">Предметы</h2>
        <p className="text-xs text-stone-500">Вес — относительная частота на колесе. Эффекты и бонусы делят одно колесо.</p>
        {Object.entries(kindLabels).map(([kind, label]) => (
          <div key={kind} className="flex flex-col gap-1">
            <h3 className="text-sm font-medium text-stone-500">{label}</h3>
            {items
              .filter((it) => it.kind === kind)
              .map((it) => {
                const row = itemRows[it.id] ?? { weight: it.weight, enabled: it.enabled, params: {} }
                return (
                  <div key={it.id} className="flex flex-col gap-1 text-sm">
                    <div className="flex items-center gap-3">
                      <label className="flex flex-1 items-center gap-2">
                        <input type="checkbox" checked={row.enabled} onChange={(e) => setItem(it.id, { enabled: e.target.checked })} />
                        {it.name}
                      </label>
                      <Input
                        type="number"
                        min={0}
                        max={1000}
                        className="w-20"
                        aria-label={`Вес «${it.name}»`}
                        value={row.weight}
                        onChange={(e) => setItem(it.id, { weight: num(e.target.value) })}
                      />
                    </div>
                    {it.params.map((p) => (
                      <label key={p.name} className="ml-6 flex flex-wrap items-center gap-2 text-xs text-stone-600 dark:text-stone-400">
                        <span className="flex-1">
                          {p.label} <span className="text-stone-400">(от {p.min} до {p.max}, обычно {p.default})</span>
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

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!title.trim() || update.isPending}>
          Сохранить
        </Button>
        {saved && !update.isPending && <span className="text-sm text-green-700">Сохранено</span>}
      </div>
      <ErrorText error={update.error} />
    </form>
  )
}
