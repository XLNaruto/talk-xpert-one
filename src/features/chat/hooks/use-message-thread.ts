import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { useChatStore } from '@/stores/chat-store'
import type { Id } from '@/types/api'
import { useMessages } from '../api/use-messages'
import { useMessageActions } from '../api/use-message-actions'
import { usePins } from '../api/use-pins'
import { startsNewDay, startsNewGroup } from '../lib/message-formatters'
import { useTypingNames } from './use-typing'
import type { Chat, ChatMessage, MessageQuote } from '../types'

/** One rendered row: the message plus the flags the list needs to lay it out. */
export interface ThreadRow {
  message: ChatMessage
  /** First of a run by the same person — gets the spacing and the author name. */
  startsGroup: boolean
  /** A day divider belongs above this one. */
  newDay: boolean
  /** True when I wrote it — drives bubble alignment and the ticks. */
  isMine: boolean
}

/**
 * Thread screen logic: the rows, the pin bar, who is typing, selection, and the
 * per-message actions. `chat-area.tsx` and `message-list.tsx` lay out markup.
 */
export function useMessageThread(chat: Chat | null) {
  const chatId = chat?.id ?? null
  const selfId = useAuthStore((s) => s.identity?.talkUserId ?? null)
  const { messages, isLoading, isLoadingMore, hasEarlier, loadEarlier } = useMessages(chatId)
  const { pins, refetch: refetchPins } = usePins(chatId)
  const typingNames = useTypingNames(chatId)
  // Destructured so the effects below can depend on the individual callbacks,
  // which are stable — the returned object is not, and would re-fire them.
  const { markRead, setPinned: pinMessage, deleteForEveryone, deleteForMe, forward } =
    useMessageActions()
  const setReplyTo = useChatStore((s) => s.setReplyTo)
  const setEditing = useChatStore((s) => s.setEditing)
  const setDraft = useChatStore((s) => s.setDraft)

  /** Ticked messages, for a bulk delete or forward. */
  const [selectedIds, setSelectedIds] = useState<Id[]>([])

  // Selection belongs to one thread. Carrying it across would delete the wrong
  // messages, so it is dropped whenever the open chat changes.
  useEffect(() => {
    setSelectedIds([])
  }, [chatId])

  /**
   * Precompute the per-row flags once, so the virtualised row renderer stays
   * cheap — it runs on every scroll frame.
   */
  const rows = useMemo<ThreadRow[]>(
    () =>
      messages.map((message, index) => {
        const previous = messages[index - 1]
        return {
          message,
          startsGroup: startsNewGroup(message, previous),
          newDay: startsNewDay(message, previous),
          isMine: message.senderTalkUserId === selfId,
        }
      }),
    [messages, selfId],
  )

  /** The pin bar shows the pinned messages we actually hold, newest first. */
  const pinnedMessages = useMemo(() => {
    if (pins.length === 0) return []
    const byId = new Map(messages.map((m) => [m.id, m]))
    return pins
      .map((pin) => byId.get(pin.messageId))
      .filter((message): message is ChatMessage => message !== undefined)
  }, [pins, messages])

  /**
   * Mark read as new messages land while the thread is open.
   *
   * Keyed on the newest id rather than on the array, so it fires once per arrival
   * instead of on every unrelated cache write.
   */
  const newestId = messages.length > 0 ? messages[messages.length - 1].id : null
  const unreadCount = chat?.unreadCount ?? 0
  useEffect(() => {
    if (chatId == null || newestId == null || newestId < 0) return
    if (unreadCount === 0) return
    markRead([chatId], newestId)
  }, [chatId, newestId, unreadCount, markRead])

  const startReply = useCallback(
    (message: ChatMessage) => {
      if (chatId == null) return
      const quote: MessageQuote = {
        id: message.id,
        senderTalkUserId: message.senderTalkUserId,
        senderName: message.senderName,
        senderPhoto: message.senderPhoto,
        type: message.type,
        body: message.body,
        isDeleted: message.isDeletedForEveryone,
      }
      setReplyTo(chatId, quote)
    },
    [chatId, setReplyTo],
  )

  /**
   * Put a message into the composer for editing.
   *
   * The target lives in the store rather than in the composer's own state, so the
   * bubble that starts the edit and the composer that finishes it do not need to
   * know about each other.
   */
  const startEditing = useCallback(
    (message: ChatMessage) => {
      if (chatId == null || message.senderTalkUserId !== selfId) return
      setEditing(chatId, { messageId: message.id, body: message.body ?? '' })
      setDraft(chatId, message.body ?? '')
      setReplyTo(chatId, null)
    },
    [chatId, selfId, setEditing, setDraft, setReplyTo],
  )

  const toggleSelected = useCallback((messageId: Id) => {
    setSelectedIds((held) =>
      held.includes(messageId)
        ? held.filter((id) => id !== messageId)
        : [...held, messageId],
    )
  }, [])

  const clearSelection = useCallback(() => setSelectedIds([]), [])

  const setPinned = useCallback(
    async (messageId: Id, pinned: boolean) => {
      if (chatId == null) return
      const ok = await pinMessage(chatId, messageId, pinned)
      // Pins expire at read time, so the bar is re-read rather than patched.
      if (ok) await refetchPins()
    },
    [chatId, pinMessage, refetchPins],
  )

  const deleteSelected = useCallback(
    async (forEveryone: boolean) => {
      if (chatId == null || selectedIds.length === 0) return
      const ok = forEveryone
        ? await deleteForEveryone(chatId, selectedIds)
        : await deleteForMe(chatId, selectedIds)
      if (ok) clearSelection()
    },
    [chatId, selectedIds, deleteForEveryone, deleteForMe, clearSelection],
  )

  /**
   * Whether "delete for everyone" may be offered.
   *
   * Anyone may hide anything they can see, but only the sender can withdraw a
   * message from other people — so a mixed selection gets the "for me" option
   * alone rather than a button that would half fail.
   */
  const canDeleteForEveryone = useMemo(() => {
    if (selectedIds.length === 0) return false
    const byId = new Map(messages.map((m) => [m.id, m]))
    return selectedIds.every((id) => byId.get(id)?.senderTalkUserId === selfId)
  }, [selectedIds, messages, selfId])

  return {
    rows,
    isLoading,
    isLoadingMore,
    hasEarlier,
    loadEarlier,
    pinnedMessages,
    typingNames,
    selfId,
    selectedIds,
    hasSelection: selectedIds.length > 0,
    canDeleteForEveryone,
    toggleSelected,
    clearSelection,
    deleteSelected,
    startReply,
    startEditing,
    setPinned,
    forward,
  }
}
