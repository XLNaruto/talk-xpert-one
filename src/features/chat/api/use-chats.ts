import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toastApiError } from '@/lib/api-toast'
import { isSocketConnected, joinChatRoom } from '@/lib/socket-client'
import { logger } from '@/lib/logger'
import { useChatListStore } from '@/stores/chat-list-store'
import type { Id } from '@/types/api'
import type { ChatListQuery } from '../types'
import { CHAT_LIST_MAX_PAGES } from '../constants'
import * as chatApi from './chat-api'

/**
 * The chat list.
 *
 * Reads into `chat-list-store` rather than into local state, because the socket
 * has to keep the same rows live — a list held in a `useState` here would be
 * unreachable from an event handler.
 *
 * Reading the list is also what ISSUES the socket grants, so every row on the
 * page is joined immediately afterwards. That is what keeps the sidebar live
 * (previews, unread badges) for chats that are not open.
 */
export function useChats(query: ChatListQuery = {}) {
  const setChats = useChatListStore((s) => s.setChats)
  const known = useChatListStore((s) => s.chats)
  const listedIds = useChatListStore((s) => s.listedIds)
  const isLoaded = useChatListStore((s) => s.isLoaded)

  const [isFetching, setFetching] = useState(false)
  const { search, type, pinnedOnly, unreadOnly } = query
  const isFiltered = Boolean(search || type || pinnedOnly || unreadOnly)

  /** Identifies the question the visible listing is an answer TO. */
  const queryKey = `${search ?? ''}|${type ?? ''}|${pinnedOnly ? 1 : 0}|${unreadOnly ? 1 : 0}`
  /** The query whose answer `listedIds` currently holds. */
  const [settledKey, setSettledKey] = useState<string | null>(null)

  /**
   * What the sidebar draws: the rows the last read returned, in the store's
   * order so a socket event still bumps one to the top. The store keeps the
   * others — the open conversation among them — so narrowing the list never
   * closes the thread.
   *
   * While a read for a DIFFERENT question is in flight, the listing on screen is
   * the previous question's answer, and drawing it is how switching from an
   * empty "Unread" back to "All" flashed "No conversations yet" for a round trip
   * before the rows it already held appeared. So the rows we hold are filtered
   * here instead, and the server's answer replaces that the moment it lands. It
   * is an approximation only for `search`, which the server matches against the
   * other participant's name as well.
   */
  const chats = useMemo(() => {
    if (settledKey !== queryKey) {
      const term = search?.trim().toLowerCase()
      return known.filter((chat) => {
        if (type && chat.type !== type) return false
        if (unreadOnly && chat.unreadCount === 0) return false
        if (pinnedOnly && !chat.self.isPinned) return false
        if (!term) return true
        return [chat.name, chat.counterpartName].some((name) =>
          name?.toLowerCase().includes(term),
        )
      })
    }
    if (listedIds === null) return known
    const listed = new Set(listedIds)
    return known.filter((chat) => listed.has(chat.id))
  }, [known, listedIds, settledKey, queryKey, search, type, pinnedOnly, unreadOnly])

  const refetch = useCallback(async () => {
    setFetching(true)
    try {
      const page = await chatApi.fetchChats({ search, type, pinnedOnly, unreadOnly })
      setChats(page.items, page.total, isFiltered ? 'filter' : 'replace')
      // The listing answers THIS question as soon as its first page is in —
      // stop filtering locally. The pages behind it only extend the same answer.
      setSettledKey(queryKey)
      // Fetch first, THEN join — a join with no preceding read is refused.
      await joinAll(page.items.map((chat) => chat.id))

      // Walk the rest of the list. A row that is never read is never joined,
      // and a chat whose room we are not in is one whose messages arrive only
      // after a reload — so "the first thirty conversations are live and the
      // rest are not" is not a state worth shipping. Bounded by
      // `CHAT_LIST_MAX_PAGES`; each page joins as it lands.
      let loaded = page.items.length
      for (let read = 1; read < CHAT_LIST_MAX_PAGES && loaded < page.total; read += 1) {
        const next = await chatApi.fetchChats({
          search,
          type,
          pinnedOnly,
          unreadOnly,
          offset: loaded,
        })
        if (next.items.length === 0) break
        setChats(next.items, next.total, 'append')
        await joinAll(next.items.map((chat) => chat.id))
        loaded += next.items.length
      }
    } catch (error) {
      toastApiError(error, 'Could not load your conversations')
    } finally {
      setFetching(false)
    }
  }, [search, type, pinnedOnly, unreadOnly, isFiltered, setChats, queryKey])

  useEffect(() => {
    void refetch()
  }, [refetch])

  return {
    chats,
    // A restored list paints immediately, so "loading" means "nothing to show
    // AND still reading" — otherwise a refetch would blank the sidebar.
    isLoading: isFetching && !isLoaded,
    isFetching,
    refetch,
  }
}

/**
 * Join every room, tolerating individual refusals.
 *
 * A `not permitted` means that chat's grant lapsed. Re-reading the chat re-issues
 * it, so the join is retried exactly once — a loop on a genuinely revoked grant
 * would hammer the API.
 *
 * A join attempted before the socket is up is a no-op, not a refusal, so the
 * whole thing is skipped in that case: retrying it would cost one wasted
 * `GET /talk/chats/:id` per row, and the `connected` catch-up joins them anyway.
 */
export async function joinAll(chatIds: Id[]): Promise<void> {
  if (!isSocketConnected()) return
  await Promise.all(
    chatIds.map(async (chatId) => {
      // The result is an OBJECT — `ok` has to be read off it, or a refusal
      // reads as a success and the room is never actually joined.
      const { ok } = await joinChatRoom(chatId)
      if (ok) return
      try {
        await chatApi.fetchChat(chatId)
        await joinChatRoom(chatId)
      } catch (error) {
        logger.warn('could not join chat room', chatId, error)
      }
    }),
  )
}

/**
 * One chat's header, kept in the same store so the header and list agree.
 *
 * When the list does not hold it — a chat opened from a link, or one whose row
 * has not landed yet — the read and the subscription are ONE round trip:
 * `talk:join` with `with_chat` answers the same body `GET /talk/chats/:id`
 * would. HTTP is the fallback for a refused join, a failed read behind an
 * accepted one, and a deployment with no socket at all.
 */
export function useChat(chatId: Id | null) {
  const chat = useChatListStore((s) => s.chats.find((c) => c.id === chatId) ?? null)
  const upsertChat = useChatListStore((s) => s.upsertChat)
  const requested = useRef<Id | null>(null)

  useEffect(() => {
    // Only read when the list doesn't already hold it — opening a chat from the
    // sidebar has the row in hand, and a second request would tell us nothing.
    if (chatId == null || chat || requested.current === chatId) return
    requested.current = chatId

    void (async () => {
      try {
        const joined = await chatApi.joinAndReadChat(chatId)
        if (joined) {
          upsertChat(joined)
          return
        }
        // Reading re-issues the grant, so the join is worth one more try after
        // it — otherwise a lapsed grant leaves a chat on screen with no events.
        upsertChat(await chatApi.fetchChat(chatId))
        await joinAll([chatId])
      } catch (error) {
        toastApiError(error, 'Could not open that conversation')
      }
    })()
  }, [chatId, chat, upsertChat])

  return chat
}
