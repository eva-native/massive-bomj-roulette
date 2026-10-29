import { describe, expect, it } from 'vitest'

/**
 * Keeps text readable in both themes. Every quoted class string is checked
 * on its own (a ternary's branches are separate strings):
 * - a light shade that reads below 4.5:1 on the dark page needs a dark:
 *   colour for the same state in the same string (`hover:text-amber-700`
 *   needs `dark:hover:text-…`);
 * - a dark shade used only on hover or focus needs one too: on the dark page
 *   it nearly vanishes (about 1.3:1);
 * - a hand-written pair that equals a utility from index.css should be that
 *   utility, so a colour change there reaches it.
 */
const lightShade = /^text-(stone-[45]00|amber-[67]00|red-600|green-700)$/
const darkShade = /^text-stone-[6789]00$/
const utilities: [string, string, string][] = [
  ['text-stone-500', 'dark:text-stone-400', 'text-muted'],
  ['text-amber-700', 'dark:text-amber-400', 'text-link'],
  ['text-red-600', 'dark:text-red-400', 'text-danger'],
  ['text-green-700', 'dark:text-green-400', 'text-success'],
]

/** What is wrong with one class string. */
function problems(classes: string): string[] {
  const tokens = classes.split(/\s+/).filter(Boolean)
  const found: string[] = []
  for (const token of tokens) {
    const parts = token.split(':')
    if (parts.includes('dark')) continue
    const shade = parts.pop()!
    const variant = parts.join(':') // '' or e.g. 'hover', 'group-hover'
    if (!lightShade.test(shade) && !(variant && darkShade.test(shade))) continue
    const pairs = variant ? [`dark:${variant}:text-`, `${variant}:dark:text-`] : ['dark:text-']
    if (!tokens.some((t) => pairs.some((p) => t.startsWith(p)))) found.push(`${token} has no dark colour`)
  }
  for (const [light, dark, utility] of utilities) {
    if (tokens.includes(light) && tokens.includes(dark)) found.push(`${light} ${dark} is ${utility}`)
  }
  return found
}

/** Every quoted string in a source file (class strings among them). */
const quoted = /'[^'\n]*'|"[^"\n]*"|`[^`]*`/g

const sources = import.meta.glob(['/src/**/*.{ts,tsx}', '!/src/**/*.test.{ts,tsx}'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>

describe('text colours', () => {
  it('read in both themes everywhere in the app', () => {
    const found: string[] = []
    for (const [file, text] of Object.entries(sources)) {
      for (const m of text.matchAll(quoted)) {
        const line = text.slice(0, m.index).split('\n').length
        for (const p of problems(m[0].slice(1, -1))) found.push(`${file}:${line}: ${p}`)
      }
    }
    expect(found).toEqual([])
  })

  it('catches what the review found slipping through', () => {
    // The old inactive tab: its own string has no dark colour, though the active branch's string does.
    expect(problems('border-transparent text-stone-500 hover:text-stone-800')).toEqual([
      'text-stone-500 has no dark colour',
      'hover:text-stone-800 has no dark colour',
    ])
    expect(problems('border-amber-500 text-stone-900 dark:text-stone-100')).toEqual([])
    expect(problems('hover:text-amber-700')).toEqual(['hover:text-amber-700 has no dark colour'])
    expect(problems('text-amber-600 underline')).toEqual(['text-amber-600 has no dark colour'])
    expect(problems('text-red-600 dark:text-red-400')).toEqual(['text-red-600 dark:text-red-400 is text-danger'])
  })

  it('accepts a colour with its dark pair for the same state', () => {
    expect(problems('hover:text-stone-800 dark:hover:text-stone-200')).toEqual([])
    expect(problems('text-stone-600 dark:text-stone-300')).toEqual([])
    expect(problems('text-muted hover:text-link')).toEqual([])
  })
})
