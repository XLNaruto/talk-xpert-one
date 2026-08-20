import { useCallback, useEffect, useState } from 'react'
import { logger } from '@/lib/logger'
import { useChatStore } from '@/stores/chat-store'
import { keyOf, type Id } from '@/types/api'
import { PIN_PAGE_SIZE } from '../constants'
import { pinKey } from '../lib/chat-mappers'
import type { PinnedMessage } from '../types'
import * as chatApi from './chat-api'

/**
 * The pinned messages of one conversation: live, unexpired pins, newest PIN
 * first — the order is when somebody decided a message mattered.
 *
 * Read at `scope=all`, so it holds BOTH kinds: the chat-wide pins everybody sees
 * and my own private bookmarks, interleaved by when each pin was made. A message
 * pinned both ways comes back TWICE, which is correct — two pins, two pinners,
 * two expiries, and unpinning one leaves the other — so rows are keyed on the
 * PAIR of message id and audience, never on the message id alone.
 *
 * Expiry is filtered at READ time rather than swept by a job, so this is re-read
 * when the thread opens and whenever a pin event lands — a cached list would keep
 * showing a pin that has since lapsed.
 *
 * SOMEBODY ELSE's pin arrives as `talk.message.pinned`, which the stream turns
 * into a bump on `pinRevision`. That is the only way an event can reach this
 * list: it lives in `useState` here, out of a socket handler's reach. My own pin
 * does not bump — `use-message-thread` re-reads as part of the write.
 *
 * Each row carries its message, so the sheet needs no second request and can
 * show a pin whose message sits a hundred pages back in the history.
 */
export function usePins(chatId: Id | null) {
  const [pins, setPins] = useState<PinnedMessage[]>([])
  const [total, setTotal] = useState(0)
  const [isLoading, setLoading] = useState(false)
  const [isLoadingMore, setLoadingMore] = useState(false)
  const revision = useChatStore((s) =>
    chatId == null ? 0 : (s.pinRevision[keyOf(chatId)] ?? 0),
  )

  const refetch = useCallback(async () => {
    if (chatId == null) {
      setPins([])
      setTotal(0)
      return
    }
    setLoading(true)
    try {
      const page = await chatApi.fetchPins(chatId, {
        scope: 'all',
        limit: PIN_PAGE_SIZE,
        offset: 0,
      })
      setPins(page.items)
      setTotal(page.total)
    } catch (error) {
      // The pin bar is an addition to the thread, not a prerequisite for it.
      logger.warn('pin read failed', chatId, error)
      setPins([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [chatId])

  useEffect(() => {
    void refetch()
  }, [refetch, revision])

  /** The next page, appended — what "Load more" in the sheet calls. */
  const loadMore = useCallback(async () => {
    if (chatId == null || isLoading || isLoadingMore) return
    const offset = pins.length
    if (offset >= total) return
    setLoadingMore(true)
    try {
      const page = await chatApi.fetchPins(chatId, { scope: 'all', limit: PIN_PAGE_SIZE, offset })
      // Merge by message id AND audience: a pin added while the sheet is open
      // shifts the page boundary, which would otherwise repeat a row rather than
      // skip it — and a message pinned both ways is two legitimate rows.
      setPins((held) => {
        const seen = new Set(held.map(pinKey))
        return [...held, ...page.items.filter((pin) => !seen.has(pinKey(pin)))]
      })
      setTotal(page.total)
    } catch (error) {
      logger.warn('pin page read failed', chatId, error)
    } finally {
      setLoadingMore(false)
    }
  }, [chatId, isLoading, isLoadingMore, pins.length, total])

  return {
    pins,
    total,
    isLoading,
    isLoadingMore,
    hasMore: pins.length < total,
    loadMore,
    refetch,
  }
}
