import { MaxReview } from '@/api/types.gen'

/** A review's length as the server counts it: code points, spaces at the ends trimmed. */
export function reviewLength(text: string): number {
  return [...text.trim()].length
}

/** Whether the server would reject the review as too long. */
export function reviewTooLong(text: string): boolean {
  return reviewLength(text) > MaxReview
}
