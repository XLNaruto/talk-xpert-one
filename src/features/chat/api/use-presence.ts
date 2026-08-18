import { useCallback, useEffect } from 'react'
import { logger } from '@/lib/logger'
import { useChatListStore, counterpartIds } from '@/stores/chat-list-store'
import { useChatStore } from '@/stores/chat-store'
import type { Id } from '@/types/api'
import * as chatApi from './chat-api'

/**
 * Presence for the people we actually display.
 *
 * `talk.presence` keeps this current, but it only fires on a CHANGE — so the
 * initial state has to be read, or everyone shows as offline until they happen to
 * toggle. The read is by counterpart id, which is why it re-runs when the chat
 * list changes rather than once at mount.
 */
export function usePresence() {
  const applyPresence = useChatStore((s) => s.applyPresence)
  // Depend on the ids, not the chat objects: a new message rewrites a row and
  // would otherwise re-read presence on every arrival.
  const idsKey = useChatListStore((s) =>
    s.chats
      .map((c) => c.counterpartTalkUserId)
      .filter((id): id is Id => id !== null)
      .sort((a, b) => a - b)
      .join(','),
  )

  const refetch = useCallback(async () => {
    const ids = counterpartIds('direct')
    if (ids.length === 0) return
    try {
      applyPresence(await chatApi.fetchPresence(ids))
    } catch (error) {
      // A presence dot is decoration; failing to read one is not worth a toast.
      logger.warn('presence read failed', error)
    }
  }, [applyPresence])

  useEffect(() => {
    if (!idsKey) return
    void refetch()
  }, [idsKey, refetch])

  return { refetch }
}

/**
 * Presence for everyone in one chat — the group member sheet.
 *
 * A single read, rather than listing members and then asking about each: this
 * endpoint checks membership itself and answers the whole chat at once.
 */
export function useChatPresence(chatId: Id | null, enabled = true) {
  const applyPresence = useChatStore((s) => s.applyPresence)

  const refetch = useCallback(async () => {
    if (chatId == null) return
    try {
      applyPresence(await chatApi.fetchChatPresence(chatId))
    } catch (error) {
      logger.warn('chat presence read failed', chatId, error)
    }
  }, [chatId, applyPresence])

  useEffect(() => {
    if (!enabled) return
    void refetch()
  }, [enabled, refetch])

  return { refetch }
}

/**
 * My own block list, loaded once so a direct chat's composer knows to offer
 * "unblock" instead of failing the send with a 403.
 */
export function useBlockList() {
  const setBlockedTalkUserIds = useChatStore((s) => s.setBlockedTalkUserIds)

  useEffect(() => {
    chatApi
      .fetchBlocks()
      .then((blocks) => setBlockedTalkUserIds(blocks.map((b) => b.talkUserId)))
      .catch((error) => logger.warn('block list read failed', error))
  }, [setBlockedTalkUserIds])
}
