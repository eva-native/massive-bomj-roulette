import { expect, it } from 'vitest'

/**
 * Raw text shades that read below 4.5:1 in one of the themes unless paired
 * with a dark: colour. Components use text-muted, text-link, text-danger and
 * text-success (index.css) instead; this keeps new code from slipping back.
 */
const lowContrast = /(?<![\w:-])(text-stone-500|text-amber-700|text-red-600|text-green-700)\b/

/** A hover colour that nearly vanishes on a dark background (about 1.3:1) unless paired with a dark: hover. */
const darkOnHover = /(?<![\w:-])hover:text-stone-[789]00\b/

const sources = import.meta.glob(['/src/**/*.{ts,tsx}', '!/src/**/*.test.{ts,tsx}'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>

it('uses text colours that read in both themes', () => {
  const found: string[] = []
  for (const [file, text] of Object.entries(sources)) {
    text.split('\n').forEach((line, i) => {
      // A line that sets its own dark colour is allowed to set a light one too.
      if (lowContrast.test(line) && !line.includes('dark:text-')) found.push(`${file}:${i + 1}: ${line.trim()}`)
      if (darkOnHover.test(line) && !line.includes('dark:hover:text-')) found.push(`${file}:${i + 1}: ${line.trim()}`)    })
  }
  expect(found).toEqual([])
})
