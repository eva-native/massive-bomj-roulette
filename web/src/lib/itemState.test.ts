import { describe, expect, it } from 'vitest'
import type { FieldView, ItemView } from '@/api/types.gen'
import { needsAction, waitingFirst } from './itemState'

const field = (extra: Partial<FieldView> = {}): FieldView => ({ name: 'levels', label: 'Пройдено уровней', type: 'int', by: 'player', optional: false, value: null, ...extra })
const item = (extra: Partial<ItemView> = {}): ItemView => ({
  id: 1,
  defId: 'dendy',
  name: 'А вы помните денди?',
  concept: '',
  kind: 'effect',
  placement: 'attached',
  blocked: false,
  status: '',
  note: '',
  fields: [],
  needsConfirm: true,
  confirmed: false,
  rejected: false,
  locked: false,
  useLabel: '',
  canUse: false,
  useHint: '',
  ...extra,
})

describe('needsAction', () => {
  it('waits for the player while a required field of theirs is empty and not sent', () => {
    expect(needsAction(item({ fields: [field()] }), 'player', true)).toBe(true)
    expect(needsAction(item({ fields: [field({ value: 7 })] }), 'player', true)).toBe(false)
    expect(needsAction(item({ fields: [field()], locked: true }), 'player', true)).toBe(false) // sent to the judge
    expect(needsAction(item({ fields: [field({ optional: true })] }), 'player', true)).toBe(false)
    expect(needsAction(item({ fields: [field({ by: 'judge' })] }), 'player', true)).toBe(false) // the judge's to fill
  })

  it('is only for the player themselves', () => {
    expect(needsAction(item({ fields: [field()] }), null, false)).toBe(false)
    expect(needsAction(item({ fields: [field()] }), 'judge', false)).toBe(false)
  })

  it('counts an item on the game that can be used now, not a bonus in the pocket', () => {
    const usable = { useLabel: 'Перекрутить', canUse: true }
    expect(needsAction(item(usable), 'player', true)).toBe(true)
    expect(needsAction(item({ ...usable, placement: 'pocket' }), 'player', true)).toBe(false)
    expect(needsAction(item(usable), 'player', false)).toBe(false) // not the player's turn to act
  })
})

it('puts the waiting items first, keeping the order otherwise', () => {
  const a = item({ id: 1 })
  const b = item({ id: 2, fields: [field()] })
  const c = item({ id: 3 })
  expect(waitingFirst([a, b, c], 'player', true).map((it) => it.id)).toEqual([2, 1, 3])
})
