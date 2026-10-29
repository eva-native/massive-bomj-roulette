import type { ItemView } from '@/api/types.gen'

/** A field nobody has filled in yet. */
export const blankValue = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)

/**
 * Whether an item on the player's game waits for them: a required field of
 * theirs is still empty and not sent, or the item can be used right now.
 * Bonuses in the pocket are not counted: they can be used almost any time,
 * and marking them all would say nothing.
 */
export function needsAction(item: ItemView, editAs: 'player' | 'judge' | null, canUse: boolean): boolean {
  const mustFill = editAs === 'player' && !item.locked && item.fields.some((f) => f.by === 'player' && !f.optional && blankValue(f.value))
  const usableNow = canUse && item.canUse && item.useLabel !== '' && item.placement !== 'pocket'
  return mustFill || usableNow
}

/** The items waiting for the player first, the rest in their order. */
export function waitingFirst(items: ItemView[], editAs: 'player' | 'judge' | null, canUse: boolean): ItemView[] {
  return [...items.filter((it) => needsAction(it, editAs, canUse)), ...items.filter((it) => !needsAction(it, editAs, canUse))]
}
