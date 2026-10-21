import { cn } from '@/lib/cn'
import { itemEmoji, kindEmoji } from '@/lib/items'

/** An item's picture from the event settings, or its default emoji. */
export function ItemIcon({
  defId,
  kind,
  icons,
  size = 'md',
}: {
  defId: string
  kind: string
  icons?: Record<string, string>
  size?: 'sm' | 'md'
}) {
  const box = size === 'sm' ? 'size-5 text-base' : 'size-8 text-2xl'
  const url = icons?.[defId]
  if (url) {
    return <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" className={cn(box, 'shrink-0 rounded object-cover')} />
  }
  return (
    <span aria-hidden className={cn(box, 'inline-flex shrink-0 items-center justify-center leading-none')}>
      {itemEmoji[defId] ?? kindEmoji[kind] ?? '❔'}
    </span>
  )
}
