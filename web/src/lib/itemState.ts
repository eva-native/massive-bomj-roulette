import type { ItemView } from '@/api/types.gen'

/**
 * A field holding no answer. The server stores no empty text or empty list
 * (an empty answer clears the field), so this is what the server calls
 * unfilled too; a bool false or a 0 is an answer.
 */
export const blankValue = (v: unknown) =>
  v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0)

/** Whether the player has filled every required field of theirs: only then the judge has something to check. */
export function playerPartFilled(item: ItemView) {
  return item.fields.every((f) => f.by !== 'player' || f.optional || !blankValue(f.value))
}

/**
 * Whether an item on a board waits for that board's player. Their part waits
 * while it is not with the judge: for an item the judge confirms, until it is
 * sent (never sent, or rejected and open again); for any other, while a
 * required field of theirs is empty. An item usable right now waits too. A
 * blocked item does nothing on the game, so it waits for nobody; bonuses in
 * the pocket can be used almost any time, so they are not marked.
 *
 * `own`: the viewer is this board's player (a judge who plays included, though
 * they may edit every field); `canAct`: it is their turn to act.
 */
export function needsAction(item: ItemView, { own, canAct }: { own: boolean; canAct: boolean }): boolean {
  if (item.blocked) return false
  const hasPart = item.fields.some((f) => f.by === 'player')
  const partOpen = item.needsConfirm ? !item.locked && !item.confirmed : !playerPartFilled(item)
  const toSend = own && hasPart && partOpen
  const usableNow = canAct && item.canUse && item.useLabel !== '' && item.placement !== 'pocket'
  return toSend || usableNow
}

/** The items with whether each waits, the waiting ones first and the order kept otherwise; worked out once per item. */
export function waitingFirst(items: ItemView[], who: { own: boolean; canAct: boolean }): { item: ItemView; waits: boolean }[] {
  const marked = items.map((item) => ({ item, waits: needsAction(item, who) }))
  return [...marked.filter((m) => m.waits), ...marked.filter((m) => !m.waits)]
}
