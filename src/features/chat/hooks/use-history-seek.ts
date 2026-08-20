import { useCallback, useRef, useState } from 'react'
import { cachedMessages } from '@/stores/message-cache-store'
import type { Id } from '@/types/api'
import { THREAD_SEARCH_MAX_HISTORY_PAGES } from '../constants'

interface HistorySeekOptions {
  chatId: Id | null
  /** Pull one more page of older history. Resolves once the page has landed. */
  loadEarlier: () => Promise<void> | void
  /** False once the thread has reached its beginning — the walk must stop there. */
  hasEarlier: boolean
}

/**
 * Walk history back until a given message is in the cache.
 *
 * The list can only scroll to a row it is drawing, and the thread only holds the
 * pages it has read. So anything that points AT a message from outside the loaded
 * window — a search hit, a pin, a reply quote — has to pull history back to it
 * first. Messages page by id from the newest end, so that means fetching every
 * page in between; the walk is bounded by `THREAD_SEARCH_MAX_HISTORY_PAGES` or a
 * pin from last year would quietly drag in the whole conversation.
 */
export function useHistorySeek({ chatId, loadEarlier, hasEarlier }: HistorySeekOptions) {
  /** True while history is being walked back to reach an off-screen message. */
  const [isSeeking, setSeeking] = useState(false)

  // The walk reads the cache and `hasEarlier` as they change mid-loop, so both
  // are mirrored into refs — the loop cannot close over a stale render's value.
  const hasEarlierRef = useRef(hasEarlier)
  hasEarlierRef.current = hasEarlier
  const loadEarlierRef = useRef(loadEarlier)
  loadEarlierRef.current = loadEarlier
  /** Guards against a second walk starting while one is in flight. */
  const seeking = useRef(false)

  const ensureLoaded = useCallback(
    async (messageId: Id): Promise<boolean> => {
      if (chatId == null) return false
      const isLoaded = () => cachedMessages(chatId).some((message) => message.id === messageId)
      if (isLoaded()) return true
      if (seeking.current) return false

      seeking.current = true
      setSeeking(true)
      try {
        for (let page = 0; page < THREAD_SEARCH_MAX_HISTORY_PAGES; page += 1) {
          if (!hasEarlierRef.current) break
          await loadEarlierRef.current()
          if (isLoaded()) return true
        }
        return isLoaded()
      } finally {
        seeking.current = false
        setSeeking(false)
      }
    },
    [chatId],
  )

  return { ensureLoaded, isSeeking }
}
