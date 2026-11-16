import { useSyncExternalStore } from 'react'

/**
 * Pictures from other sites that failed to load, remembered for the life of
 * the page. Every item icon, game cover and wheel sector with the same link
 * shows its fallback at once instead of asking again: alphapve has 17 dead
 * icon links on every screen with items, and the wheel's ticker switches
 * icons many times a second. A picture that loads clears its mark.
 */
const broken = new Set<string>()
const listeners = new Set<() => void>()
let version = 0

function changed() {
  version++
  for (const l of listeners) l()
}

export function markBroken(url: string) {
  if (broken.has(url)) return
  broken.add(url)
  changed()
}

/** The picture loaded, or the judge set the link again: show it (and try it) again. */
export function forgetBroken(url: string) {
  if (broken.delete(url)) changed()
}

export function isBroken(url: string) {
  return broken.has(url)
}

/** Only full http(s) links are loaded: a half-typed link would hit the app itself. */
export function isPictureLink(url: string | undefined): url is string {
  return !!url && /^https?:\/\/[^/\s]+\.[^/\s]+/.test(url)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Re-renders the component whenever a picture breaks or loads again; read with isBroken. */
export function useBrokenImages() {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  )
  return isBroken
}

/** Tests start from a clean page. */
export function forgetAllBrokenImages() {
  broken.clear()
  changed()
}
