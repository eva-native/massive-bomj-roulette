import { useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { cn } from '@/lib/cn'

type Tab = { to: string; label: string; accessibleLabel?: string; mark?: 'action' | 'timer' }

/** Scroll only the tab row; bringing the active tab into view must not move the page. */
export function EventTabs({ base, tabs, active }: { base: string; tabs: Tab[]; active: string }) {
  const ref = useRef<HTMLElement>(null)
  const [edges, setEdges] = useState({ left: false, right: false })
  const labels = tabs.map((t) => t.label).join('|')
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setEdges({ left: el.scrollLeft > 1, right: el.scrollWidth - el.clientWidth - el.scrollLeft > 1 })
    const reveal = () => {
      const selected = el.querySelector<HTMLElement>('[aria-current="page"]')
      if (selected) {
        const row = el.getBoundingClientRect()
        const tab = selected.getBoundingClientRect()
        if (tab.right > row.right - 16) el.scrollLeft += tab.right - row.right + 16
        else if (tab.left < row.left + 16) el.scrollLeft -= row.left - tab.left + 16
      }
      measure()
    }
    reveal()
    el.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', reveal)
    const ro = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(reveal)
    ro?.observe(el)
    return () => {
      el.removeEventListener('scroll', measure)
      window.removeEventListener('resize', reveal)
      ro?.disconnect()
    }
  }, [active, base, labels])

  return (
    <div className="relative min-w-0">
      <nav ref={ref} aria-label="Разделы ивента" className="flex gap-1 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_var(--color-stone-200)] dark:shadow-[inset_0_-1px_0_var(--color-stone-800)]">
        {tabs.map((t) => (
          <Link key={t.to} to={`${base}${t.to ? `/${t.to}` : ''}`} aria-current={active === t.to ? 'page' : undefined} aria-label={t.accessibleLabel}
            className={cn('flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap', active === t.to ? 'border-amber-500 text-stone-900 dark:text-stone-100' : 'border-transparent text-muted hover:text-stone-800 dark:hover:text-stone-200')}>
            {t.label}
            {t.mark === 'action' && <span aria-hidden className="size-2 rounded-full bg-amber-500" />}
            {t.mark === 'timer' && <span aria-hidden>⏱</span>}
          </Link>
        ))}
      </nav>
      {edges.left && <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-4 bg-gradient-to-r from-stone-50 dark:from-stone-950" />}
      {edges.right && <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-4 bg-gradient-to-l from-stone-50 dark:from-stone-950" />}
    </div>
  )
}
