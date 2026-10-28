import { useItems } from '@/api/events'
import type { ItemDef } from '@/api/types.gen'
import { ItemIcon } from '@/components/ItemIcon'
import { RuleText } from '@/components/RuleText'
import { Badge, ErrorText, Loading } from '@/components/ui'
import { kindLabels } from '@/lib/items'
import { RULES_URL } from '@/lib/links'
import { useEventContext } from './context'

export function RulesTab() {
  const { event } = useEventContext()
  const items = useItems(event.slug)

  if (items.isPending) return <Loading />
  if (items.isError) return <ErrorText error={items.error} />

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-stone-500">
        Как идёт ход и считаются очки — в{' '}
        <a href={RULES_URL} target="_blank" rel="noreferrer" className="text-amber-700 underline">
          общих правилах ивента
        </a>
        .
      </p>
      {Object.entries(kindLabels).map(([kind, label]) => {
        const list = items.data.filter((it) => it.kind === kind)
        if (list.length === 0) return null
        return (
          <section key={kind} className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">{label}</h2>
            {list.map((it) => (
              <ItemCard key={it.id} item={it} icons={event.settings.icons} />
            ))}
          </section>
        )
      })}
    </div>
  )
}

function ItemCard({ item, icons }: { item: ItemDef; icons: Record<string, string> }) {
  return (
    <article
      className={`rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-900 ${item.enabled ? '' : 'opacity-50'}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-medium">
          <ItemIcon defId={item.id} kind={item.kind} icons={icons} />
          {item.name}
        </h3>
        <div className="flex gap-2">
          {!item.enabled && <Badge>выключен</Badge>}
          <Badge>вес {item.weight}</Badge>
        </div>
      </div>
      <RuleText text={item.concept} className="mt-1" />
    </article>
  )
}
