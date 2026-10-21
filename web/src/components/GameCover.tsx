/** A small cover picture, or nothing when the game has none. */
export function GameCover({ url, title, size = 'sm' }: { url: string; title: string; size?: 'sm' | 'lg' }) {
  if (!url) return null
  return (
    <img
      src={url}
      alt={`Обложка «${title}»`}
      loading="lazy"
      referrerPolicy="no-referrer"
      className={size === 'sm' ? 'h-14 w-10 shrink-0 rounded object-cover' : 'h-36 w-24 shrink-0 rounded-lg object-cover'}
    />
  )
}
