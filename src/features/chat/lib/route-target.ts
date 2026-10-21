import type { Id } from '@/types/api'

/**
 * What the main pane has open — the one thing the `?data=` token carries.
 *
 * A broadcast list is NOT a chat and its ids come from a different table, so a
 * bare number cannot say which of the two it names. The plaintext is tagged:
 * `42` is a chat (the shape tokens have always had, so old links still open),
 * `b:42` a broadcast list, `b:all` the history across every list.
 */
export type RouteTarget =
  | { kind: 'chat'; id: Id }
  | { kind: 'broadcast'; target: Id | 'all' }

const BROADCAST_PREFIX = 'b:'

/** The plaintext for a target, before encryption. `null` when nothing is open. */
export function routeTargetText(
  chatId: Id | null,
  broadcastId: Id | 'all' | null,
): string | null {
  if (broadcastId !== null) return `${BROADCAST_PREFIX}${broadcastId}`
  return chatId === null ? null : String(chatId)
}

/** Reads a decrypted token back. Anything malformed is `null`, never a guess. */
export function parseRouteTarget(text: string | null): RouteTarget | null {
  if (text === null) return null
  if (text.startsWith(BROADCAST_PREFIX)) {
    const rest = text.slice(BROADCAST_PREFIX.length)
    if (rest === 'all') return { kind: 'broadcast', target: 'all' }
    const id = toId(rest)
    return id === null ? null : { kind: 'broadcast', target: id }
  }
  const id = toId(text)
  return id === null ? null : { kind: 'chat', id }
}

function toId(text: string): Id | null {
  const id = Number(text)
  return text !== '' && Number.isInteger(id) && id > 0 ? id : null
}
