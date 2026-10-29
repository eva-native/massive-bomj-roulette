import { forgetBroken, isPictureLink, markBroken, useBrokenImages } from '@/lib/brokenImages'
import { cn } from '@/lib/cn'

/**
 * A game's cover. A grey box holds its place while it loads; a broken link
 * hides it (the page remembers it, see lib/brokenImages). Nothing when the
 * game has no cover.
 */
export function GameCover({ url, title, size = 'sm' }: { url: string; title: string; size?: 'sm' | 'lg' }) {
  const isBroken = useBrokenImages()
  if (!isPictureLink(url) || isBroken(url)) return null
  return (
    <img
      key={url}
      src={url}
      alt={`Обложка «${title}»`}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => markBroken(url)}
      onLoad={() => forgetBroken(url)}
      className={cn('shrink-0 bg-stone-200 object-cover dark:bg-stone-700', size === 'sm' ? 'h-14 w-10 rounded' : 'h-36 w-24 rounded-lg')}
    />
  )
}
