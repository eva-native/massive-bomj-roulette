import { cloneElement, isValidElement, useId } from 'react'
import type { ComponentPropsWithRef, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'
import { markBroken, useBrokenImages } from '@/lib/brokenImages'

const control =
  'w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-900 disabled:opacity-60'

export function Input({ className, ...props }: ComponentPropsWithRef<'input'>) {
  return <input className={cn(control, className)} {...props} />
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, 'min-h-20', className)} {...props} />
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(control, className)} {...props} />
}

/** A single labelled control. Its hint describes it, while `after` stays separate. */
export function Field({
  label,
  hint,
  after,
  required = false,
  className,
  children,
}: {
  label: string
  hint?: string
  after?: ReactNode
  /** Marks the field «обязательно» on screen; the control itself says so to a screen reader (`required`). */
  required?: boolean
  className?: string
  children: ReactNode
}) {
  const hintId = useId()
  const control = hint && isValidElement<{ 'aria-describedby'?: string }>(children)
    ? cloneElement(children, { 'aria-describedby': [children.props['aria-describedby'], hintId].filter(Boolean).join(' ') })
    : children
  return (
    <div className={cn('flex flex-col gap-1 text-sm', className)}>
      <label className="flex flex-col gap-1">
        <span className="font-medium">
          {label}
          {required && <RequiredMark />}
        </span>
        {control}
      </label>
      {after}
      {hint && <span id={hintId} className="text-xs text-muted">{hint}</span>}
    </div>
  )
}

/** «· обязательно» after a field's name, left out of its accessible name. */
export function RequiredMark() {
  return (
    <span className="text-xs font-normal text-muted" aria-hidden>
      {' '}
      · обязательно
    </span>
  )
}

export function Card({ className, children, id }: { className?: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className={cn('scroll-mt-4 rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900', className)}>
      {children}
    </section>
  )
}

export function Badge({ children, tone = 'stone' }: { children: ReactNode; tone?: 'stone' | 'amber' | 'green' | 'red' }) {
  const tones = {
    stone: 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300',
    amber: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
    green: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
    red: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  }
  return <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium wrap-normal', tones[tone])}>{children}</span>
}

export function ErrorText({ error }: { error: Error | null | undefined }) {
  if (!error) return null
  return (
    <p role="alert" className="text-sm text-danger">
      {error.message}
    </p>
  )
}

export function Avatar({ name, url, size = 'md' }: { name: string; url?: string; size?: 'sm' | 'md' }) {
  const isBroken = useBrokenImages()
  const box = size === 'sm' ? 'size-7 text-xs' : 'size-10'
  if (url && !isBroken(url)) return <img key={url} src={url} alt="" onError={() => markBroken(url)} className={cn(box, 'shrink-0 rounded-full object-cover')} />
  return (
    <div aria-hidden className={cn(box, 'flex shrink-0 items-center justify-center rounded-full bg-amber-500 font-bold text-stone-950')}>
      {name.slice(0, 1).toUpperCase()}
    </div>
  )
}

export function Loading() {
  return <p className="p-8 text-center text-muted">Загрузка…</p>
}
