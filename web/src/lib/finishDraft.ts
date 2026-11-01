import { useEffect, useState } from 'react'
import { emptyHMS, type HMS } from './hours'

/**
 * The outcome form of a game, kept in this browser (localStorage) like the
 * timer, so a reload or the judge's rejection does not lose what the player
 * wrote: the engine clears the hours and the link on rejection. The board
 * drops it once the judge confirms the game.
 */
export type Outcome = 'completed' | 'dropped' | 'tech'
export type FinishDraft = { outcome: Outcome; time: HMS; proof: string; review: string }

export const emptyDraft: FinishDraft = { outcome: 'completed', time: emptyHMS, proof: '', review: '' }

export function finishKey(slug: string, playthroughId: number) {
  return `mbr:finish:${slug}:${playthroughId}`
}

const outcomes: Outcome[] = ['completed', 'dropped', 'tech']
const text = (v: unknown) => (typeof v === 'string' ? v : '')

function load(key: string): FinishDraft {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return emptyDraft
    const v = JSON.parse(raw) as Partial<Record<keyof FinishDraft, unknown>>
    const t = (v.time ?? {}) as Partial<Record<keyof HMS, unknown>>
    return {
      outcome: outcomes.includes(v.outcome as Outcome) ? (v.outcome as Outcome) : 'completed',
      time: { h: text(t.h), m: text(t.m), s: text(t.s) },
      proof: text(v.proof),
      review: text(v.review),
    }
  } catch {
    return emptyDraft
  }
}

function isEmpty(d: FinishDraft) {
  return d.outcome === 'completed' && !d.time.h && !d.time.m && !d.time.s && !d.proof && !d.review
}

function store(key: string, d: FinishDraft) {
  try {
    if (isEmpty(d)) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(d))
  } catch {
    // Storage may be blocked (private mode); the form still works until reload.
  }
}

export function dropFinishDraft(key: string) {
  try {
    localStorage.removeItem(key)
  } catch {
    // Nothing was stored then.
  }
}

/** The form's fields, restored from and saved to this browser. */
export function useFinishDraft(key: string) {
  const [draft, setDraft] = useState<FinishDraft>(() => load(key))
  useEffect(() => store(key, draft), [key, draft])
  const update = (patch: Partial<FinishDraft>) => setDraft((d) => ({ ...d, ...patch }))
  return [draft, update] as const
}
