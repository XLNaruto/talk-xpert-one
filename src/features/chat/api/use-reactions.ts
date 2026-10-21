import { useEffect, useState } from 'react'
import { toApiError } from '@/lib/api-error'
import type { Id } from '@/types/api'
import type { ReactionBreakdown } from '../types'
import * as chatApi from './chat-api'

/**
 * "View reactions" — who reacted with what, one tab at a time.
 *
 * `emoji` is the open tab (`null` for All). Each tab is its own read because the
 * server filters `items` for it, while `total` and the chips — the tab badges —
 * come back the same on every one, so the strip never jumps between tabs.
 */
export function useReactionBreakdown(chatId: Id, messageId: Id, emoji: string | null) {
  const [breakdown, setBreakdown] = useState<ReactionBreakdown | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    chatApi
      .fetchReactions(chatId, messageId, emoji ?? undefined)
      .then((answer) => {
        if (!cancelled) setBreakdown(answer)
      })
      .catch((cause) => {
        if (cancelled) return
        // A 404 is a message withdrawn while the sheet was opening, and says so.
        setError(
          toApiError(cause).status === 404
            ? 'This message is no longer available.'
            : 'Reactions could not be loaded. Close this and try again.',
        )
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [chatId, messageId, emoji])

  return { breakdown, error, isLoading }
}
