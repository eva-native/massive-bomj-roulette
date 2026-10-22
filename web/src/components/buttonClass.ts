import { cn } from '@/lib/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'discord'

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-amber-500 text-stone-950 hover:bg-amber-400',
  secondary: 'bg-stone-200 text-stone-900 hover:bg-stone-300 dark:bg-stone-800 dark:text-stone-100 dark:hover:bg-stone-700',
  discord: 'bg-[#5865F2] text-white hover:bg-[#4752c4]',
}

/** Button styles, also used for links that look like buttons. */
export const buttonClass = (variant: ButtonVariant = 'primary', className?: string) =>
  cn(
    'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium wrap-normal transition-colors',
    'disabled:cursor-not-allowed disabled:opacity-50',
    variants[variant],
    className,
  )
