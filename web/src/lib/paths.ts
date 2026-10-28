/** The page with a player's board in an event; every link to a board uses it. */
export function playerPath(slug: string, playerId: number): string {
  return `/e/${encodeURIComponent(slug)}/players/${playerId}`
}
