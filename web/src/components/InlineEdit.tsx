import { useLayoutEffect, useRef, type ReactNode } from 'react'

/** Keep keyboard focus in an inline edit and return it to its trigger on close. */
export function InlineEdit({ active, onCancel, children, className = 'contents' }: {
  active: boolean
  onCancel: () => void
  children: ReactNode
  className?: string
}) {
  const root = useRef<HTMLDivElement>(null)
  const wasActive = useRef(false)
  useLayoutEffect(() => {
    if (active) root.current?.querySelector<HTMLElement>('input:not(:disabled), textarea:not(:disabled), select:not(:disabled)')?.focus()
    else if (wasActive.current && (document.activeElement === document.body || root.current?.contains(document.activeElement))) {
      // Another editor may already have opened in the same commit.
      root.current?.querySelector<HTMLElement>('[data-edit-trigger]')?.focus()
    }
    wasActive.current = active
  }, [active])
  return (
    <div ref={root} className={className} onKeyDown={(e) => {
      if (active && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel() }
    }}>
      {children}
    </div>
  )
}
