import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'

/** How much of the page must be left below the screen for the button to show, in screens. */
const minScreensLeft = 1

function screensLeft() {
  const left = document.documentElement.scrollHeight - window.scrollY - window.innerHeight
  return left / window.innerHeight
}

/** A round button in the corner that jumps to the bottom of a long page. */
export function ScrollToBottom() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const update = () => setShow(screensLeft() > minScreensLeft)
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    // Pages grow when their data arrives, without any scroll or resize.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(document.body)
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      observer?.disconnect()
    }
  }, [])

  if (!show) return null
  const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  return (
    <button
      type="button"
      aria-label="Вниз страницы"
      title="Вниз страницы"
      onClick={() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })}
      className={cn(
        'fixed right-4 bottom-4 z-40 flex size-11 items-center justify-center rounded-full shadow-lg transition-colors',
        'bg-stone-200 text-stone-900 hover:bg-stone-300 dark:bg-stone-800 dark:text-stone-100 dark:hover:bg-stone-700',
      )}
    >
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 5v14M5 12l7 7 7-7" />
      </svg>
    </button>
  )
}
