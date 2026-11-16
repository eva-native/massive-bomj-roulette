import { useState } from 'react'
import { useItems } from '@/api/events'
import type { ItemDef } from '@/api/types.gen'
import { ItemIcon } from '@/components/ItemIcon'
import { RuleText } from '@/components/RuleText'
import { Badge, ErrorText, Loading, Field, Input } from '@/components/ui'
import { cn } from '@/lib/cn'
import { kindLabels } from '@/lib/items'
import { RULES_URL } from '@/lib/links'
import { useEventContext } from './context'

export function RulesTab() {
  const { event } = useEventContext()
  const items = useItems(event.slug)
  const [search, setSearch] = useState('')

  if (items.isPending) return <Loading />
  if (items.isError) return <ErrorText error={items.error} />

  const query = search.trim().toLocaleLowerCase('ru')
  const shown = items.data.filter((it) => `${it.name} ${it.concept}`.toLocaleLowerCase('ru').includes(query))
  const total = (kind: string) => items.data.filter((it) => it.enabled && (kind === 'drop' ? it.kind === 'drop' : it.kind !== 'drop')).reduce((n, it) => n + it.weight, 0)
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted">
        Как идёт ход и считаются очки — в{' '}
        <a href={RULES_URL} target="_blank" rel="noreferrer" className="text-link underline">
          общих правилах ивента
        </a>
        .
      </p>
      <Field label="Найти предмет"><Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} /></Field>
      <nav aria-label="Виды предметов" className="flex flex-wrap gap-3">
        {Object.entries(kindLabels).map(([kind, label]) => <a key={kind} href={`#items-${kind}`} className="text-link underline">{label} {shown.filter((it) => it.kind === kind).length}</a>)}
      </nav>
      <p className="text-xs text-muted">Базовый шанс по весам ивента. Эффекты и бонусы делят колесо; на колесе игрока шансы зависят от доступных ему предметов.</p>
      {shown.length === 0 && <p role="status">Ничего не найдено.</p>}
      {Object.entries(kindLabels).map(([kind, label]) => {
        const list = shown.filter((it) => it.kind === kind).sort((a, b) => Number(b.enabled) - Number(a.enabled))
        if (list.length === 0) return null
        return (
          <section id={`items-${kind}`} key={kind} className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">{label}</h2>
            {list.map((it) => (
              <ItemCard key={it.id} item={it} total={total(kind)} icons={event.settings.icons} />
            ))}
          </section>
        )
      })}
    </div>
  )
}

function ItemCard({ item, icons, total }: { item: ItemDef; icons: Record<string, string>; total: number }) {
  return (
    <article
      // A disabled item stays readable: a dashed border and the «выключен» badge mark it, not transparency.
      className={cn(
        'rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-900',
        !item.enabled && 'border-dashed border-stone-300 dark:border-stone-700',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-medium">
          <ItemIcon defId={item.id} kind={item.kind} icons={icons} />
          {item.name}
        </h3>
        <div className="flex gap-2">
          {!item.enabled && <Badge>выключен</Badge>}
          <Badge>шанс {((item.enabled && total > 0 ? item.weight / total : 0) * 100).toLocaleString('ru', { maximumFractionDigits: 2 })} %</Badge>
        </div>
      </div>
      <RuleText text={item.concept} className="mt-1" />
    </article>
  )
}
