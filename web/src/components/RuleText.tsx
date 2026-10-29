import { Fragment } from 'react'
import { cn } from '@/lib/cn'

const linkRe = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g

/** The rule text of an item: keeps line breaks and turns [text](url) into links. */
export function RuleText({ text, className }: { text: string; className?: string }) {
  const parts: (string | { label: string; href: string })[] = []
  let last = 0
  for (const m of text.matchAll(linkRe)) {
    parts.push(text.slice(last, m.index), { label: m[1]!, href: m[2]! })
    last = m.index + m[0].length
  }
  parts.push(text.slice(last))

  return (
    <p className={cn('text-sm whitespace-pre-line text-stone-600 dark:text-stone-400', className)}>
      {parts.map((p, i) =>
        typeof p === 'string' ? (
          <Fragment key={i}>{p}</Fragment>
        ) : (
          <a key={i} href={p.href} target="_blank" rel="noreferrer" className="text-link underline">
            {p.label}
          </a>
        ),
      )}
    </p>
  )
}
