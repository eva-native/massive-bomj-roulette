import { useOutletContext } from 'react-router'
import type { EventDetail } from '@/api/types.gen'

export type EventContext = { event: EventDetail }

/** The event loaded by EventLayout, for its tabs. */
export function useEventContext() {
  return useOutletContext<EventContext>()
}
