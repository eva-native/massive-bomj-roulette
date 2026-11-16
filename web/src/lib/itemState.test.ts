import { describe, expect, it } from 'vitest'
import type { FieldView, ItemView } from '@/api/types.gen'
import { blankValue, needsAction, playerPartFilled, waitingFirst } from './itemState'

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
  fields: [field()],
  needsConfirm: true,
  confirmed: false,
  rejected: false,
  locked: false,
  useLabel: '',
  canUse: false,
  useHint: '',
  ...extra,
})
const owner = { own: true, canAct: true }

describe('blank fields', () => {
  it('count empty text and an empty list as blank, as the server does, but not «no» or 0', () => {
    for (const v of [null, undefined, '', '   ', []]) expect(blankValue(v), JSON.stringify(v)).toBe(true)
    for (const v of [false, 0, 'x', [3]]) expect(blankValue(v), JSON.stringify(v)).toBe(false)
  })

  it('agree between «sent to the judge» and «waits for the player»', () => {
    const empty = item({ fields: [field({ type: 'players', value: [] })], needsConfirm: false })
    expect(playerPartFilled(empty)).toBe(false)
    expect(needsAction(empty, owner)).toBe(true)
  })
})

describe('needsAction', () => {
  it('waits for the player until their part is sent to the judge', () => {
    expect(needsAction(item(), owner)).toBe(true) // never sent
    expect(needsAction(item({ fields: [field({ value: 7 })] }), owner)).toBe(true) // filled but not sent
    expect(needsAction(item({ fields: [field({ value: 7 })], locked: true }), owner)).toBe(false) // with the judge
    expect(needsAction(item({ fields: [field({ value: 7 })], confirmed: true, locked: true }), owner)).toBe(false)
  })

  it('waits again once the judge rejects', () => {
    // ConfirmItem(accept=false) opens the item again: Rejected, not Submitted, so not locked.
    expect(needsAction(item({ fields: [field({ value: 7 })], rejected: true, locked: false }), owner)).toBe(true)
  })

  it('without the judge, waits while a required field is empty', () => {
    expect(needsAction(item({ needsConfirm: false }), owner)).toBe(true)
    expect(needsAction(item({ needsConfirm: false, fields: [field({ value: 3 })] }), owner)).toBe(false)
    expect(needsAction(item({ needsConfirm: false, fields: [field({ optional: true })] }), owner)).toBe(false)
  })

  it('does not ask anything of a blocked item: it does nothing on the game', () => {
    expect(needsAction(item({ blocked: true }), owner)).toBe(false)
    expect(needsAction(item({ blocked: true, useLabel: 'Перекрутить', canUse: true, fields: [] }), owner)).toBe(false)
  })

  it("is about whose board it is, not who may edit: a judge who plays sees their own, nobody else's", () => {
    expect(needsAction(item(), { own: true, canAct: false })).toBe(true)
    expect(needsAction(item(), { own: false, canAct: false })).toBe(false)
  })

  it("is not asked of fields that are the judge's", () => {
    expect(needsAction(item({ fields: [field({ by: 'judge' })] }), owner)).toBe(false)
  })

  it('counts an item on the game that can be used now, not a bonus in the pocket', () => {
    const usable = { fields: [], useLabel: 'Перекрутить', canUse: true }
    expect(needsAction(item(usable), owner)).toBe(true)
    expect(needsAction(item({ ...usable, placement: 'pocket' }), owner)).toBe(false)
    expect(needsAction(item(usable), { own: true, canAct: false })).toBe(false)
  })
})

it('puts the waiting items first, keeping the order otherwise, and says which wait', () => {
  const done = (id: number) => item({ id, fields: [field({ value: 1 })], locked: true })
  const out = waitingFirst([done(1), item({ id: 2 }), done(3)], owner)
  expect(out.map((m) => [m.item.id, m.waits])).toEqual([
    [2, true],
    [1, false],
    [3, false],
  ])
})
