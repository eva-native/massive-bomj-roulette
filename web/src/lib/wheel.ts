import type { EventSettings } from '@/api/types.gen'

/** The wheel's default spin, in seconds. */
export const DEFAULT_WHEEL_SECONDS = 4.5

/** How long a wheel of this kind turns in the event (games and movies share one setting). */
export function wheelSeconds(settings: EventSettings | undefined, kind: string): number {
  const s = kind === 'games' || kind === 'movies' ? settings?.gameWheelSeconds : settings?.itemWheelSeconds
  return s && s > 0 ? s : DEFAULT_WHEEL_SECONDS
}
