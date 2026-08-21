import { useCallback, useEffect, useRef, useState } from 'react'
import { toastApiError } from '@/lib/api-toast'
import { joinChatRoom } from '@/lib/socket-client'
import { logger } from '@/lib/logger'
import { useMessageCacheStore, newestMessageId, oldestMessageId } from '@/stores/message-cache-store'
import { keyOf, type Id } from '@/types/api'
import {
  MESSAGE_OPENING_LIMIT,
  MESSAGE_PAGE_SIZE,
  THREAD_HISTORY_PAGE_COOLDOWN_MS,
} from '../constants'
import { resyncPreview } from '../hooks/use-message-stream'
import * as chatApi from './chat-api'

/**
 * One shared empty page. A fresh `[]` per render would give `rows` a new
 * identity every time, which hands Virtuoso new `data` and re-renders the list
 * for a thread that has nothing in it.
 */
const NO_MESSAGES: never[] = []

/**
 * History for one chat, backed by the in-memory cache — nothing is persisted, so
 * a reload always re-reads the newest page from the API.
 *
 * Opening a thread reads it and then joins its room — in that order, because a
 * join with no preceding read is refused. The read also refreshes the grant, so
 * a chat kept open never lapses.
 */
export function useMessages(chatId: Id | null) {
  const messages = useMessageCacheStore((s) => (chatId == null ? undefined : s.byChat[keyOf(chatId)]))
  const paging = useMessageCacheStore((s) => (chatId == null ? undefined : s.paging[keyOf(chatId)]))
  const setPage = useMessageCacheStore((s) => s.setPage)
  const retain = useMessageCacheStore((s) => s.retain)

  const [isLoading, setLoading] = useState(false)
  const [isLoadingMore, setLoadingMore] = useState(false)
  /**
   * The same flag as a ref. `startReached` can fire again before React has
   * re-rendered with `isLoadingMore` true, and two reads from the same cursor
   * would fetch the same page twice.
   */
  const loadingMoreRef = useRef(false)
  /**
   * When the next history page may be asked for. See
   * `THREAD_HISTORY_PAGE_COOLDOWN_MS` — without it one flick to the top pulls
   * the whole conversation in a burst, each page prepending before Virtuoso has
   * compensated the scroll for the last.
   */
  const nextPageAllowedAtRef = useRef(0)
  /**
   * The chat this hook last issued the opening read for.
   *
   * A ref rather than a set of every chat seen: ENTERING a chat is what asks
   * the server for the reader's unread run (`limit: -1`), so coming back to one
   * visited earlier has to ask again — the cache has been collecting arrivals
   * in the meantime and knows nothing about where reading stopped. It still
   * reads once per entry: the effect below runs on other identities too, and
   * this is what keeps those from refetching.
   */
  const openedChatRef = useRef<string | null>(null)

  const loadLatest = useCallback(
    async (chatIdToLoad: Id) => {
      setLoading(true)
      try {
        // The opening read, not a page: `-1` asks the server for the reader's
        // whole unread run plus the context above it, so the divider and every
        // message under it are in this one answer.
        const page = await chatApi.fetchMessages(chatIdToLoad, {
          limit: MESSAGE_OPENING_LIMIT,
        })
        setPage(chatIdToLoad, page.items, {
          oldestId: page.oldestId,
          hasMore: page.hasMore,
        })
        // The row quotes this chat's newest message, and two things about it are
        // only knowable from the message itself: whether it is a tombstone, and
        // whether it has been read. Opening the chat is when the sidebar can
        // finally be told.
        resyncPreview(chatIdToLoad)
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
    if (openedChatRef.current === key) return
    openedChatRef.current = key
    // Bound the cache before the page lands, so this chat is never the one evicted.
    retain(chatId)
    void loadLatest(chatId)
  }, [chatId, loadLatest, retain])

  /**
   * One page older, from the oldest id held.
   *
   * `immediate` skips the between-pages rest. That rest exists for SCROLLING —
   * one flick to the top would otherwise fire seven requests before Virtuoso had
   * compensated for the first — but a SEEK is a loop of deliberate pages with
   * nothing to compensate, and the cooldown turned it into twenty-five refusals
   * in a millisecond, ending in "that message is too far back" for a message
   * three pages up.
   */
  const fetchEarlier = useCallback(async (immediate: boolean) => {
    if (chatId == null || loadingMoreRef.current) return
    if (!immediate && Date.now() < nextPageAllowedAtRef.current) return
    if (paging?.hasMore === false) return
    // The topmost ROW is the cursor, not the last page's `oldestId` — see
    // `oldestMessageId`. Falls back to the recorded cursor for the window
    // between `retain` evicting the rows and the first page landing.
    const oldestId = oldestMessageId(chatId) ?? paging?.oldestId
    if (oldestId == null) return

    loadingMoreRef.current = true
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
      nextPageAllowedAtRef.current = Date.now() + THREAD_HISTORY_PAGE_COOLDOWN_MS
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [chatId, paging?.oldestId, paging?.hasMore, setPage])

  /** Scroll-driven paging: rests between pages. */
  const loadEarlier = useCallback(() => fetchEarlier(false), [fetchEarlier])
  /** Seek-driven paging: walks as fast as the API answers. */
  const loadEarlierNow = useCallback(() => fetchEarlier(true), [fetchEarlier])

  return {
    messages: messages ?? NO_MESSAGES,
    // Rows already held paint at once, so this only covers an empty thread.
    isLoading: isLoading && !messages?.length,
    isLoadingMore,
    hasEarlier: paging?.hasMore !== false && Boolean(paging?.oldestId),
    loadEarlier,
    loadEarlierNow,
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
      // The gap we just replayed may end on a message that changed the row.
      resyncPreview(chatId)
    }
  } catch (error) {
    logger.warn('catch-up read failed', chatId, error)
  }
}
