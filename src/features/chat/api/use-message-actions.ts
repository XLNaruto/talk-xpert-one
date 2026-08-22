import { useCallback } from 'react'
import { toastApiError, toastSuccess } from '@/lib/api-toast'
import { useChatListStore } from '@/stores/chat-list-store'
import { useChatStore } from '@/stores/chat-store'
import { hasPinnedMessages, useMessageCacheStore } from '@/stores/message-cache-store'
import type { Id } from '@/types/api'
import { resyncPreview } from '../hooks/use-message-stream'
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
  const bumpPins = useChatStore((s) => s.bumpPins)
  const clearUnread = useChatListStore((s) => s.clearUnread)
  const setUnreadCount = useChatListStore((s) => s.setUnread)

  /** Sender only. On a media message this edits the caption. */
  const edit = useCallback(
    async (chatId: Id, messageId: Id, body: string): Promise<boolean> => {
      try {
        const saved = await chatApi.editMessage(chatId, messageId, body)
        // No success toast: the bubble redraws with its new text and an
        // "edited" marker, which says it better than a notification would.
        applyEdit(chatId, saved.messageId, saved.body, saved.editedAt)
        // The sidebar quotes the newest message, so an edit to it changes the
        // preview. No echo comes back for my own write.
        resyncPreview(chatId)
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
      // Asked BEFORE the rows go: afterwards there is nothing left to ask.
      const wasPinned = hasPinnedMessages(chatId, messageIds)
      try {
        await chatApi.deleteMessages(chatId, messageIds, false)
        removeMany(chatId, messageIds)
        // A pinned message that has just left my view cannot go on being
        // announced in my pin bar. Only the endpoint knows what is left, so the
        // bar and the sheet are asked to re-read rather than patched.
        if (wasPinned) bumpPins(chatId)
        // Deleting FOR ME drops the row, so the message BEFORE it becomes the
        // sidebar's preview. Nothing is broadcast for this one, by design.
        resyncPreview(chatId)
        return true
      } catch (error) {
        toastApiError(error, 'Those messages were not removed')
        return false
      }
    },
    [removeMany, bumpPins],
  )

  /** Delete FOR EVERYONE — a tombstone, because replies still point at it. */
  const deleteForEveryone = useCallback(
    async (chatId: Id, messageIds: Id[]): Promise<boolean> => {
      const wasPinned = hasPinnedMessages(chatId, messageIds)
      try {
        await chatApi.deleteMessages(chatId, messageIds, true)
        applyDeleteForEveryone(chatId, messageIds)
        // The tombstone drops both pins on the row; the lists above it have to
        // be told, or the bar keeps announcing a message that says only "this
        // message was deleted".
        if (wasPinned) bumpPins(chatId)
        // The tombstone stays the newest row, so the preview becomes "This
        // message was deleted" rather than the blank that read as "Attachment".
        resyncPreview(chatId)
        return true
      } catch (error) {
        toastApiError(error, 'Those messages were not deleted')
        return false
      }
    },
    [applyDeleteForEveryone, bumpPins],
  )

  /**
   * Pin, either way round and for either audience.
   *
   * `forEveryone` is the whole difference between an announcement and a
   * bookmark: one changes the chat's announcement bar, the other is a private
   * bookmark nobody else sees. A pin confirms itself on screen, so it is silent.
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
    (chatIds: Id[], uptoMessageId?: Id, remainingUnread = 0) => {
      if (chatIds.length === 0) return
      // A receipt that stopped partway leaves the rest unread, and the row has
      // to say so — the thread counts what is still below the reader and passes
      // it here. Only meaningful for ONE chat; a bulk mark-read clears them all.
      if (chatIds.length === 1 && remainingUnread > 0) {
        setUnreadCount(chatIds[0], remainingUnread)
      } else {
        for (const chatId of chatIds) clearUnread(chatId)
      }
      void chatApi.markChatsRead(chatIds, uptoMessageId).catch(() => undefined)
    },
    [clearUnread, setUnreadCount],
  )

  return { edit, deleteForMe, deleteForEveryone, setPinned, forward, markRead }
}
