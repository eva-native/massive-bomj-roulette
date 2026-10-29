import { forgetBroken, isPictureLink, markBroken, useBrokenImages } from '@/lib/brokenImages'
import { cn } from '@/lib/cn'
import { itemEmoji, kindEmoji } from '@/lib/items'

/**
 * An item's picture from the event settings, or its default emoji. A picture
 * that fails to load (a dead link) falls back to the emoji too, instead of a
 * broken-image box; the page remembers it (lib/brokenImages), so other icons
 * with the same link do not ask for it again.
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
  const isBroken = useBrokenImages()
  const box = size === 'sm' ? 'size-5 text-base' : 'size-8 text-2xl'
  const url = icons?.[defId]
  if (isPictureLink(url) && !isBroken(url)) {
    return (
      <img
        // A new element per link: a late error of the previous picture cannot mark this one.
        key={url}
        src={url}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => markBroken(url)}
        onLoad={() => forgetBroken(url)}
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
