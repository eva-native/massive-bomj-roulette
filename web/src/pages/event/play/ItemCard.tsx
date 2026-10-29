import { useState, type FormEvent, type ReactNode, type Ref } from 'react'
import { useItemInput, useUseItem } from '@/api/play'
import type { FieldView, ItemView, Member } from '@/api/types.gen'
import { Button } from '@/components/Button'
import { Folded } from '@/components/Folded'
import { ItemIcon } from '@/components/ItemIcon'
import { RuleText } from '@/components/RuleText'
import { Badge, ErrorText, Input, Select } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useEventContext } from '../context'

const kindTone: Record<string, 'amber' | 'green' | 'stone'> = { effect: 'amber', bonus: 'green', drop: 'stone' }
const kindName: Record<string, string> = { effect: 'эффект', bonus: 'бонус', drop: 'дроп-дебафф' }

/**
 * One item: its rule, state and, if allowed, its input form and use button.
 * `editAs` says which fields the viewer may fill.
 */
export function ItemCard({
  slug,
  item,
  members,
  editAs,
  canUse,
  compact = false,
  count = 1,
  hideHint = false,
}: {
  slug: string
  item: ItemView
  members: Member[]
  editAs: 'player' | 'judge' | null
  canUse: boolean
  /** Fold the rule to three lines (the board's side column and pocket, where several cards stack). */
  compact?: boolean
  /** How many identical items this card stands for (the pocket groups them). */
  count?: number
  /** The reason it cannot be used is said once for the whole pocket. */
  hideHint?: boolean
}) {
  const use = useUseItem(slug)
  const { event } = useEventContext()

  return (
    // A blocked item keeps its text readable (its rule still matters): a dashed border and the badge mark it, not transparency.
    <article
      className={cn(
        'rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-900',
        item.blocked && 'border-dashed border-stone-300 dark:border-stone-700',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <ItemIcon defId={item.defId} kind={item.kind} icons={event.settings.icons} />
        <h4 className="font-medium">{item.name}</h4>
        {count > 1 && <span className="text-sm font-semibold text-muted">×{count}</span>}
        <Badge tone={kindTone[item.kind]}>{kindName[item.kind] ?? item.kind}</Badge>
        {item.status && <Badge>{item.status}</Badge>}
        {item.note && <Badge tone="amber">{item.note}</Badge>}
        {item.blocked && <Badge>заблокирован</Badge>}
        {item.needsConfirm && !item.confirmed && !item.rejected && playerPartFilled(item) && <Badge>ждёт судью</Badge>}
        {item.confirmed && <Badge tone="green">подтверждено</Badge>}
        {item.rejected && <Badge>отклонено</Badge>}
        {item.placement === 'used' && <Badge>использован</Badge>}
      </div>
      {compact ? (
        <Folded lines={3} more="Подробнее" watch={item.concept} className="mt-1">
          {({ ref, className }) => <RuleText ref={ref as Ref<HTMLParagraphElement>} text={item.concept} className={className} />}
        </Folded>
      ) : (
        <RuleText text={item.concept} className="mt-1" />
      )}

      {item.fields.length > 0 && <ItemFields slug={slug} item={item} members={members} editAs={editAs} />}

      {item.useLabel && canUse && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button variant="secondary" disabled={!item.canUse || use.isPending} onClick={() => use.mutate(item.id)}>
            {item.useLabel}
          </Button>
          {!item.canUse && item.useHint && !hideHint && <span className="text-xs text-muted">{item.useHint}</span>}
        </div>
      )}
      <ErrorText error={use.error} />
    </article>
  )
}

function ItemFields({ slug, item, members, editAs }: { slug: string; item: ItemView; members: Member[]; editAs: 'player' | 'judge' | null }) {
  const input = useItemInput(slug)
  // Once sent to the judge, the owner waits for the decision (issue #2).
  const editable = (f: FieldView) => editAs === 'judge' || (editAs === 'player' && f.by === 'player' && !item.locked)
  const [values, setValues] = useState<Record<string, unknown>>(() => Object.fromEntries(item.fields.map((f) => [f.name, f.value])))
  const anyEditable = item.fields.some(editable)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const changed = Object.fromEntries(item.fields.filter(editable).map((f) => [f.name, values[f.name]]).filter(([, v]) => v !== undefined && v !== null && v !== ''))
    input.mutate({ itemId: item.id, values: changed })
  }

  return (
    <form onSubmit={submit} className="mt-2 flex flex-col gap-2 text-sm">
      {item.fields.map((f) =>
        // Only a field the viewer may fill is a form control; the rest are read as text, so
        // nobody sees an empty form they cannot fill. In the pocket an empty one is left out.
        editable(f) ? (
          <FieldControl key={f.name} field={f} value={values[f.name]} members={members} onChange={(v) => setValues((prev) => ({ ...prev, [f.name]: v }))} />
        ) : (
          <FieldValue key={f.name} field={f} members={members} hideEmpty={item.placement === 'pocket'} />
        ),
      )}
      {anyEditable && (
        <Button type="submit" variant="secondary" className="self-start" disabled={input.isPending}>
          {editAs === 'player' && item.needsConfirm ? 'Отправить результат' : 'Сохранить'}
        </Button>
      )}
      {editAs === 'player' && item.locked && !item.confirmed && <p className="text-xs text-muted">Отправлено судье. Изменить можно, если судья отклонит.</p>}
      <ErrorText error={input.error} />
    </form>
  )
}

/** Who fills a judge's field, said after its name (the name itself may already say «судьи»). */
function JudgeMark({ field }: { field: FieldView }) {
  return field.by === 'judge' ? <span className="text-xs text-muted"> · заполняет судья</span> : null
}

/** A field the viewer cannot fill, as text: «Чью игру судим: KillReal_Blaze». */
function FieldValue({ field, members, hideEmpty }: { field: FieldView; members: Member[]; hideEmpty: boolean }) {
  const v = field.value
  const name = (id: unknown) => members.find((m) => m.userId === id)?.name ?? `#${String(id)}`
  let text: ReactNode = null
  if (field.type === 'bool' && typeof v === 'boolean') text = v ? 'да' : 'нет'
  else if (field.type === 'player' && typeof v === 'number') text = name(v)
  else if (field.type === 'players' && Array.isArray(v) && v.length > 0) text = v.map(name).join(', ')
  else if (field.type === 'url' && typeof v === 'string' && v) {
    text = (
      <a href={v} target="_blank" rel="noreferrer" className="break-all text-link underline">
        {v}
      </a>
    )
  } else if ((typeof v === 'string' && v) || typeof v === 'number') text = String(v)
  if (text === null && hideEmpty) return null
  return (
    <p>
      <span className="text-muted">{field.label}:</span> {text ?? <span className="text-muted">{field.by === 'judge' ? 'заполнит судья' : '—'}</span>}
    </p>
  )
}

function FieldControl({
  field,
  value,
  members,
  onChange,
}: {
  field: FieldView
  value: unknown
  members: Member[]
  onChange: (v: unknown) => void
}) {
  const label = (
    <>
      {field.label}
      <JudgeMark field={field} />
    </>
  )
  switch (field.type) {
    case 'bool':
      return (
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          <span>{label}</span>
        </label>
      )
    case 'int':
      return (
        <label className="flex flex-wrap items-center gap-2">
          <span className="min-w-32">{label}</span>
          <Input
            type="number"
            min={0}
            className="w-24"
            value={typeof value === 'number' ? value : ''}
            onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
          />
        </label>
      )
    case 'player':
      return (
        <label className="flex flex-wrap items-center gap-2">
          <span className="min-w-32">{label}</span>
          <Select className="max-w-xs" value={typeof value === 'number' ? value : ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}>
            <option value="">—</option>
            {members
              .filter((m) => m.isParticipant)
              .map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
          </Select>
        </label>
      )
    case 'players': {
      const list = Array.isArray(value) ? (value as number[]) : []
      return (
        <fieldset className="flex flex-col gap-1">
          <legend>{label}</legend>
          {members
            .filter((m) => m.isParticipant)
            .map((m) => (
              <label key={m.userId} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={list.includes(m.userId)}
                  onChange={(e) => onChange(e.target.checked ? [...list, m.userId] : list.filter((id) => id !== m.userId))}
                />
                {m.name}
              </label>
            ))}
        </fieldset>
      )
    }
    default:
      return (
        <label className="flex flex-wrap items-center gap-2">
          <span className="min-w-32">{label}</span>
          <Input
            type={field.type === 'url' ? 'url' : 'text'}
            className="max-w-sm"
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      )
  }
}

/** Whether the player has filled every required field of theirs: only then the judge has something to check. */
function playerPartFilled(item: ItemView) {
  return item.fields.every((f) => f.by !== 'player' || f.optional || (f.value !== null && f.value !== undefined))
}
