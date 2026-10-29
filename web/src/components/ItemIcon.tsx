import { useState } from 'react'
import { cn } from '@/lib/cn'
import { itemEmoji, kindEmoji } from '@/lib/items'

/**
 * An item's picture from the event settings, or its default emoji. A picture
 * that fails to load (a dead link, an expired Discord attachment) falls back
 * to the emoji too, instead of a broken-image box.
 */
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
  // Keyed by the address, so a new link from the judge is tried again.
  const [broken, setBroken] = useState<string | null>(null)
  const box = size === 'sm' ? 'size-5 text-base' : 'size-8 text-2xl'
  const url = icons?.[defId]
  if (url && broken !== url) {
    return (
      <img
        src={url}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setBroken(url)}
        className={cn(box, 'shrink-0 rounded object-cover')}
      />
    )
  }
  return (
    <span aria-hidden className={cn(box, 'inline-flex shrink-0 items-center justify-center leading-none')}>
      {itemEmoji[defId] ?? kindEmoji[kind] ?? '❔'}
    </span>
  )
}
