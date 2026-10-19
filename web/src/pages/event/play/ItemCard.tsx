import { useState, type FormEvent } from 'react'
import { useItemInput, useUseItem } from '@/api/play'
import type { FieldView, ItemView, Member } from '@/api/types.gen'
import { Button } from '@/components/Button'
import { RuleText } from '@/components/RuleText'
import { Badge, ErrorText, Input, Select } from '@/components/ui'
import { cn } from '@/lib/cn'

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
}: {
  slug: string
  item: ItemView
  members: Member[]
  editAs: 'player' | 'judge' | null
  canUse: boolean
}) {
  const use = useUseItem(slug)

  return (
    <article className={cn('rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-900', item.blocked && 'opacity-60')}>
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="font-medium">{item.name}</h4>
        <Badge tone={kindTone[item.kind]}>{kindName[item.kind] ?? item.kind}</Badge>
        {item.status && <Badge>{item.status}</Badge>}
        {item.note && <Badge tone="amber">{item.note}</Badge>}
        {item.blocked && <Badge>заблокирован</Badge>}
        {item.needsConfirm && !item.confirmed && !item.rejected && <Badge>ждёт судью</Badge>}
        {item.confirmed && <Badge tone="green">подтверждено</Badge>}
        {item.rejected && <Badge>отклонено</Badge>}
        {item.placement === 'used' && <Badge>использован</Badge>}
      </div>
      <RuleText text={item.concept} className="mt-1" />

      {item.fields.length > 0 && <ItemFields slug={slug} item={item} members={members} editAs={editAs} />}

      {item.useLabel && canUse && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button variant="secondary" disabled={!item.canUse || use.isPending} onClick={() => use.mutate(item.id)}>
            {item.useLabel}
          </Button>
          {!item.canUse && item.useHint && <span className="text-xs text-stone-500">{item.useHint}</span>}
        </div>
      )}
      <ErrorText error={use.error} />
    </article>
  )
}

function ItemFields({ slug, item, members, editAs }: { slug: string; item: ItemView; members: Member[]; editAs: 'player' | 'judge' | null }) {
  const input = useItemInput(slug)
  const editable = (f: FieldView) => editAs === 'judge' || (editAs === 'player' && f.by === 'player')
  const [values, setValues] = useState<Record<string, unknown>>(() => Object.fromEntries(item.fields.map((f) => [f.name, f.value])))
  const anyEditable = item.fields.some(editable)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const changed = Object.fromEntries(item.fields.filter(editable).map((f) => [f.name, values[f.name]]).filter(([, v]) => v !== undefined && v !== null && v !== ''))
    input.mutate({ itemId: item.id, values: changed })
  }

  return (
    <form onSubmit={submit} className="mt-2 flex flex-col gap-2 text-sm">
      {item.fields.map((f) => (
        <FieldControl
          key={f.name}
          field={f}
          value={values[f.name]}
          members={members}
          disabled={!editable(f)}
          onChange={(v) => setValues((prev) => ({ ...prev, [f.name]: v }))}
        />
      ))}
      {anyEditable && (
        <Button type="submit" variant="secondary" className="self-start" disabled={input.isPending}>
          Сохранить
        </Button>
      )}
      <ErrorText error={input.error} />
    </form>
  )
}

function FieldControl({
  field,
  value,
  members,
  disabled,
  onChange,
}: {
  field: FieldView
  value: unknown
  members: Member[]
  disabled: boolean
  onChange: (v: unknown) => void
}) {
  const label = `${field.label}${field.by === 'judge' ? ' (судья)' : ''}`
  switch (field.type) {
    case 'bool':
      return (
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={value === true} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
          {label}
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
            disabled={disabled}
            onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
          />
        </label>
      )
    case 'player':
      return (
        <label className="flex flex-wrap items-center gap-2">
          <span className="min-w-32">{label}</span>
          <Select value={typeof value === 'number' ? value : ''} disabled={disabled} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}>
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
                  disabled={disabled}
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
            value={typeof value === 'string' ? value : ''}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      )
  }
}
