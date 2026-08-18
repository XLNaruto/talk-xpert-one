import { useCallback, useEffect, useRef, useState } from 'react'
import { toastApiError } from '@/lib/api-toast'
import { joinChatRoom } from '@/lib/socket-client'
import { logger } from '@/lib/logger'
import { useMessageCacheStore, newestMessageId } from '@/stores/message-cache-store'
import { keyOf, type Id } from '@/types/api'
import { MESSAGE_PAGE_SIZE } from '../constants'
import * as chatApi from './chat-api'

/**
 * History for one chat, backed by the IndexedDB cache so a cold start paints
 * instantly and the network fill-in merges in behind it.
 *
 * Opening a thread reads it and then joins its room — in that order, because a
 * join with no preceding read is refused. The read also refreshes the grant, so
 * a chat kept open never lapses.
 */
export function useMessages(chatId: Id | null) {
  const messages = useMessageCacheStore((s) => (chatId == null ? undefined : s.byChat[keyOf(chatId)]))
  const paging = useMessageCacheStore((s) => (chatId == null ? undefined : s.paging[keyOf(chatId)]))
  const setPage = useMessageCacheStore((s) => s.setPage)

  const [isLoading, setLoading] = useState(false)
  const [isLoadingMore, setLoadingMore] = useState(false)
  /** Which chats this mount has already read, so a re-render can't refetch. */
  const opened = useRef(new Set<string>())

  const loadLatest = useCallback(
    async (chatIdToLoad: Id) => {
      setLoading(true)
      try {
        const page = await chatApi.fetchMessages(chatIdToLoad, { limit: MESSAGE_PAGE_SIZE })
        setPage(chatIdToLoad, page.items, {
          oldestId: page.oldestId,
          hasMore: page.hasMore,
        })
        await joinChatRoom(chatIdToLoad)
      } catch (error) {
        toastApiError(error, 'Could not load this conversation')
      } finally {
        setLoading(false)
      }
    },
    [setPage],
  )

  useEffect(() => {
    if (chatId == null) return
    const key = keyOf(chatId)
    if (opened.current.has(key)) return
    opened.current.add(key)
    void loadLatest(chatId)
  }, [chatId, loadLatest])

  /** Scroll up: one page older, from the oldest id held. */
  const loadEarlier = useCallback(async () => {
    if (chatId == null || isLoadingMore) return
    const oldestId = paging?.oldestId
    if (oldestId == null || paging?.hasMore === false) return

    setLoadingMore(true)
    try {
      const page = await chatApi.fetchMessages(chatId, {
        beforeId: oldestId,
        limit: MESSAGE_PAGE_SIZE,
      })
      setPage(chatId, page.items, {
        // A page with nothing in it means we reached the start; keep the cursor
        // where it was so a retry doesn't walk off the beginning.
        oldestId: page.oldestId ?? oldestId,
        hasMore: page.items.length > 0 && page.hasMore,
      })
    } catch (error) {
      toastApiError(error, 'Could not load earlier messages')
    } finally {
      setLoadingMore(false)
    }
  }, [chatId, isLoadingMore, paging?.oldestId, paging?.hasMore, setPage])

  return {
    messages: messages ?? [],
    // Restored rows paint at once, so this only covers a genuinely empty thread.
    isLoading: isLoading && !messages?.length,
    isLoadingMore,
    hasEarlier: paging?.hasMore !== false && Boolean(paging?.oldestId),
    loadEarlier,
    reload: useCallback(() => (chatId == null ? undefined : loadLatest(chatId)), [chatId, loadLatest]),
  }
}

/**
 * Replay the gap after a reconnect.
 *
 * Realtime delivery is best-effort with NO replay buffer, so anything emitted
 * while we were disconnected is gone from the socket and has to be re-read.
 * `after_id` is exactly that read, and the newest id we hold is the boundary.
 *
 * Not a hook — the catch-up runs from a socket handler, outside React.
 */
export async function catchUpMessages(chatId: Id): Promise<void> {
  const afterId = newestMessageId(chatId)
  if (afterId == null) return
  try {
    const page = await chatApi.fetchMessages(chatId, { afterId, limit: 100 })
    if (page.items.length > 0) {
      useMessageCacheStore.getState().upsertMany(chatId, page.items)
    }
  } catch (error) {
    logger.warn('catch-up read failed', chatId, error)
  }
}
