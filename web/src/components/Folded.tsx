import { useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react'
import { cn } from '@/lib/cn'

/** Tailwind needs the class names written out. */
const clamp = { 3: 'line-clamp-3', 6: 'line-clamp-6' } as const

/**
 * Text folded to `lines` lines, with a button to open it, shown only when the
 * clamp really hides something (that depends on the width, so it is measured
 * again on resize). `children` renders the text element with the given ref
 * and clamp class.
 */
export function Folded({
  lines,
  more,
  less = 'Свернуть',
  watch,
  className,
  children,
}: {
  lines: keyof typeof clamp
  more: string
  less?: string
  /** What changes the text; measured again when it does. */
  watch: unknown
  className?: string
  children: (text: { ref: Ref<HTMLElement>; className: string | undefined }) => ReactNode
}) {
  const ref = useRef<HTMLElement>(null)
  const [open, setOpen] = useState(false)
  const [folds, setFolds] = useState(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || open) return
    const check = () => setFolds(el.scrollHeight > el.clientHeight + 1)
    check()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [watch, open])

  return (
    <div className={cn('flex w-full flex-col items-start gap-1', className)}>
      {children({ ref, className: open ? undefined : clamp[lines] })}
      {folds && (
        <button type="button" aria-expanded={open} className="text-xs text-link hover:underline" onClick={() => setOpen(!open)}>
          {open ? less : more}
        </button>
      )}
    </div>
  )
}
