import { useCallback } from 'react'
import { toastApiError, toastSuccess } from '@/lib/api-toast'
import { useChatListStore } from '@/stores/chat-list-store'
import { useMessageCacheStore } from '@/stores/message-cache-store'
import type { Id } from '@/types/api'
import * as chatApi from './chat-api'

/**
 * Per-message writes: edit, the two deletes, pin, forward, mark-read.
 *
 * Each applies to the cache optimistically and reverts on failure, because the
 * confirming socket event only arrives for the actions that HAVE one — a delete
 * for me is deliberately silent, so waiting for an event would hang the UI.
 */
export function useMessageActions() {
  const applyEdit = useMessageCacheStore((s) => s.applyEdit)
  const applyDeleteForEveryone = useMessageCacheStore((s) => s.applyDeleteForEveryone)
  const removeMany = useMessageCacheStore((s) => s.removeMany)
  const applyPinned = useMessageCacheStore((s) => s.applyPinned)
  const clearUnread = useChatListStore((s) => s.clearUnread)

  /** Sender only. On a media message this edits the caption. */
  const edit = useCallback(
    async (chatId: Id, messageId: Id, body: string): Promise<boolean> => {
      try {
        const saved = await chatApi.editMessage(chatId, messageId, body)
        applyEdit(chatId, saved.messageId, saved.body, saved.editedAt)
        toastSuccess('Message edited')
        return true
      } catch (error) {
        toastApiError(error, 'That edit did not save')
        return false
      }
    },
    [applyEdit],
  )

  /**
   * Delete FOR ME — the rows leave my view and nobody is told. No event fires,
   * by design: the other party must never learn you hid their message.
   */
  const deleteForMe = useCallback(
    async (chatId: Id, messageIds: Id[]): Promise<boolean> => {
      try {
        await chatApi.deleteMessages(chatId, messageIds, false)
        removeMany(chatId, messageIds)
        toastSuccess(
          messageIds.length === 1 ? 'Message removed' : `${messageIds.length} messages removed`,
        )
        return true
      } catch (error) {
        toastApiError(error, 'Those messages were not removed')
        return false
      }
    },
    [removeMany],
  )

  /** Delete FOR EVERYONE — a tombstone, because replies still point at it. */
  const deleteForEveryone = useCallback(
    async (chatId: Id, messageIds: Id[]): Promise<boolean> => {
      try {
        await chatApi.deleteMessages(chatId, messageIds, true)
        applyDeleteForEveryone(chatId, messageIds)
        toastSuccess(
          messageIds.length === 1
            ? 'Message deleted for everyone'
            : `${messageIds.length} messages deleted for everyone`,
        )
        return true
      } catch (error) {
        toastApiError(error, 'Those messages were not deleted')
        return false
      }
    },
    [applyDeleteForEveryone],
  )

  /**
   * Pin, either way round and for either audience.
   *
   * `forEveryone` is the whole difference between an announcement and a
   * bookmark, so it is named in the toast too: a user who meant to save a
   * message for themselves must never be left wondering whether the chat saw it.
   */
  const setPinned = useCallback(
    async (
      chatId: Id,
      messageId: Id,
      pinned: boolean,
      forEveryone = true,
    ): Promise<boolean> => {
      applyPinned(chatId, messageId, pinned, forEveryone)
      try {
        await chatApi.setMessagePinned(chatId, messageId, pinned, { forEveryone })
        toastSuccess(pinTitle(pinned, forEveryone))
        return true
      } catch (error) {
        applyPinned(chatId, messageId, !pinned, forEveryone)
        toastApiError(error, pinned ? 'That message was not pinned' : 'That pin was not removed')
        return false
      }
    },
    [applyPinned],
  )

  /** A forward is a NEW message in each destination, not a pointer. */
  const forward = useCallback(
    async (messageIds: Id[], toChatIds: Id[]): Promise<boolean> => {
      try {
        await chatApi.forwardMessages(messageIds, toChatIds)
        toastSuccess(
          toChatIds.length === 1
            ? 'Forwarded to 1 conversation'
            : `Forwarded to ${toChatIds.length} conversations`,
        )
        return true
      } catch (error) {
        toastApiError(error, 'Those messages were not forwarded')
        return false
      }
    },
    [],
  )

  /**
   * Mark read. Clears MY badge and turns the sender's ticks blue, so it runs on
   * opening a thread and on every new message while it is open.
   *
   * Fire-and-forget: a failed receipt must not block reading, and the next
   * message re-sends it anyway.
   */
  const markRead = useCallback(
    (chatIds: Id[], uptoMessageId?: Id) => {
      if (chatIds.length === 0) return
      for (const chatId of chatIds) clearUnread(chatId)
      void chatApi.markChatsRead(chatIds, uptoMessageId).catch(() => undefined)
    },
    [clearUnread],
  )

  return { edit, deleteForMe, deleteForEveryone, setPinned, forward, markRead }
}

/** What a pin toast says — the audience is the part worth confirming. */
function pinTitle(pinned: boolean, forEveryone: boolean): string {
  if (forEveryone) return pinned ? 'Pinned for everyone' : 'Pin removed for everyone'
  return pinned ? 'Pinned for me' : 'Unpinned for me'
}
