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
  return <PageScrollButton direction="down" />
}

export function ScrollToTop() {
  return <PageScrollButton direction="up" />
}

function PageScrollButton({ direction }: { direction: 'up' | 'down' }) {
  const [show, setShow] = useState(false)
  const [aboveBottom, setAboveBottom] = useState(false)

  useEffect(() => {
    const update = () => {
      const typing = document.activeElement?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
      const down = window.innerWidth >= 640 && screensLeft() > minScreensLeft && !typing
      setShow(direction === 'down' ? down : window.scrollY > window.innerHeight && !typing)
      setAboveBottom(direction === 'up' && down)
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    document.addEventListener('focusin', update)
    // focusout fires before activeElement moves to the next target.
    const afterBlur = () => queueMicrotask(update)
    document.addEventListener('focusout', afterBlur)
    // Pages grow when their data arrives, without any scroll or resize.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(document.body)
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      document.removeEventListener('focusin', update)
      document.removeEventListener('focusout', afterBlur)
      observer?.disconnect()
    }
  }, [direction])

  // When hidden, the button stays in the page, only invisible: removing it would drop the
  // keyboard focus to the top of the page right after a press scrolled to the bottom.
  const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const label = direction === 'up' ? 'Вверх страницы' : 'Вниз страницы'
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      tabIndex={show ? 0 : -1}
      data-shown={show}
      onClick={() => window.scrollTo({ top: direction === 'up' ? 0 : document.documentElement.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })}
      className={cn(
        'fixed right-4 z-40 flex size-11 items-center justify-center rounded-full shadow-lg transition',
        aboveBottom ? 'bottom-18' : 'bottom-4',
        !show && 'pointer-events-none opacity-0',
        'bg-stone-200 text-stone-900 hover:bg-stone-300 dark:bg-stone-800 dark:text-stone-100 dark:hover:bg-stone-700',
      )}
    >
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={direction === 'up' ? 'M12 19V5M5 12l7-7 7 7' : 'M12 5v14M5 12l7 7 7-7'} />
      </svg>
    </button>
  )
}
