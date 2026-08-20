import { useCallback, useEffect, useState } from 'react'
import { toastApiError, toastSuccess } from '@/lib/api-toast'
import { useChatStore } from '@/stores/chat-store'
import type { Id } from '@/types/api'
import type { BlockedPerson } from '../types'
import * as chatApi from './chat-api'

/**
 * Everyone I have blocked — the ROWS, not just the ids.
 *
 * `useBlockList` (in `use-presence.ts`) reads the same endpoint once at start-up
 * for the ids alone, because that is all the composer needs to know. A screen
 * that lists the people needs their names, photos and when it happened, and it
 * needs them FRESH — a block made on another device since sign-in would be
 * missing from the start-up read — so this fetches on open rather than
 * projecting the store.
 *
 * `GET /talk/blocks` is MY list in one direction: it never reports who has
 * blocked me, which is why there is no "blocked you" section to render.
 */
export function useBlockedPeople(enabled: boolean) {
  const setBlockedTalkUserIds = useChatStore((s) => s.setBlockedTalkUserIds)
  const setBlocked = useChatStore((s) => s.setBlocked)
  const [people, setPeople] = useState<BlockedPerson[]>([])
  const [isLoading, setLoading] = useState(false)
  const [pendingId, setPendingId] = useState<Id | null>(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    setLoading(true)
    chatApi
      .fetchBlocks()
      .then((items) => {
        if (cancelled) return
        setPeople(items)
        // The authoritative answer just arrived, so the ids the composer reads
        // are corrected by the same pass rather than left to drift.
        setBlockedTalkUserIds(items.map((person) => person.talkUserId))
      })
      .catch((error) => {
        if (!cancelled) toastApiError(error, 'Could not load your blocked contacts')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [enabled, setBlockedTalkUserIds])

  /**
   * Optimistic: the row leaves the list at once and comes back if the write is
   * refused, so an unblock reads as instant without lying about what saved.
   */
  const unblock = useCallback(
    async (person: BlockedPerson): Promise<boolean> => {
      setPendingId(person.talkUserId)
      setPeople((held) => held.filter((row) => row.talkUserId !== person.talkUserId))
      setBlocked(person.talkUserId, false)
      try {
        await chatApi.setPersonBlocked(person.talkUserId, false)
        toastSuccess('Unblocked')
        return true
      } catch (error) {
        setPeople((held) =>
          [...held, person].sort((a, b) => b.blockedAt.localeCompare(a.blockedAt)),
        )
        setBlocked(person.talkUserId, true)
        toastApiError(error, 'That change did not save')
        return false
      } finally {
        setPendingId(null)
      }
    },
    [setBlocked],
  )

  return { people, isLoading, pendingId, unblock }
}
