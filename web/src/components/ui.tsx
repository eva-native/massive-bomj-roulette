import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

const control =
  'w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-900 disabled:opacity-60'

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, className)} {...props} />
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, 'min-h-20', className)} {...props} />
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(control, className)} {...props} />
}

/**
 * A labelled form control. The label wraps the control so it is linked
 * without ids; the hint stays outside so it is not part of the field name.
 */
/** A labelled field. `after` and `hint` stay outside the label, so they are not part of the field name. */
export function Field({
  label,
  hint,
  after,
  className,
  children,
}: {
  label: string
  hint?: string
  after?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn('flex flex-col gap-1 text-sm', className)}>
      <label className="flex flex-col gap-1">
        <span className="font-medium">{label}</span>
        {children}
      </label>
      {after}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </div>
  )
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={cn('rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900', className)}>
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
  const box = size === 'sm' ? 'size-7 text-xs' : 'size-10'
  if (url) return <img src={url} alt="" className={cn(box, 'rounded-full')} />
  return (
    <div className={cn(box, 'flex items-center justify-center rounded-full bg-amber-500 font-bold text-stone-950')}>
      {name.slice(0, 1).toUpperCase()}
    </div>
  )
}

export function Loading() {
  return <p className="p-8 text-center text-muted">Загрузка…</p>
}
