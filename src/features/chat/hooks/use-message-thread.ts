import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { useChatStore } from '@/stores/chat-store'
import type { Id } from '@/types/api'
import { useMessages } from '../api/use-messages'
import { useMessageActions } from '../api/use-message-actions'
import { usePins } from '../api/use-pins'
import { startsNewDay, startsNewGroup } from '../lib/message-formatters'
import { useTypingNames } from './use-typing'
import { useThreadScroll } from './use-thread-scroll'
import type { Chat, ChatMessage, MessageQuote, PinnedMessage } from '../types'

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
  const {
    pins,
    total: pinTotal,
    isLoading: isLoadingPins,
    isLoadingMore: isLoadingMorePins,
    hasMore: hasMorePins,
    loadMore: loadMorePins,
    refetch: refetchPins,
  } = usePins(chatId)
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

  /**
   * The pinned messages, newest pin first.
   *
   * Every pin carries its own copy of the message, so a pin from months back
   * renders without walking the history to find it. The THREAD's copy still wins
   * where we hold one: it is the copy an edit or a delete-for-everyone has been
   * applied to, and the pin's copy is a snapshot from the moment of the read.
   */
  const pinnedRows = useMemo(() => {
    if (pins.length === 0) return []
    const byId = new Map(messages.map((m) => [m.id, m]))
    return pins
      .map((pin) => {
        const message = byId.get(pin.messageId) ?? pin.message
        return message ? { pin, message } : null
      })
      .filter((row): row is { pin: PinnedMessage; message: ChatMessage } => row !== null)
  }, [pins, messages])

  /**
   * What the one-line bar above the thread draws: the CHAT-WIDE pins only.
   *
   * The bar is the announcement everybody in the conversation sees, so a private
   * bookmark has no business in it — it would read as "everyone can see this"
   * for something only I pinned. The sheet holds both and says which is which.
   */
  const pinnedMessages = useMemo(
    () => pinnedRows.filter((row) => row.pin.forEveryone).map((row) => row.message),
    [pinnedRows],
  )

  /** How many of those the bar's counter is over — the server's own total
      minus my private rows, which the bar never shows. */
  const pinnedForEveryoneTotal = useMemo(
    () => Math.max(pinTotal - pinnedRows.filter((row) => !row.pin.forEveryone).length, 0),
    [pinTotal, pinnedRows],
  )

  /**
   * Send a receipt for what has actually been seen.
   *
   * The thread no longer marks itself read the moment it opens: that would clear
   * the frontier before the reader had looked at anything, and the unread
   * divider would never have a place to sit. `use-thread-scroll.ts` decides WHEN
   * — when those rows were on screen and the list had stopped moving — and calls
   * this with the newest message that was visible.
   */
  const markReadUpTo = useCallback(
    (uptoMessageId: Id) => {
      if (chatId == null || uptoMessageId < 0) return
      markRead([chatId], uptoMessageId)
    },
    [chatId, markRead],
  )

  // The unread state as it stood when the chat was OPENED. Frozen here because
  // `markReadUpTo` clears the live count within a second of arriving, and the
  // divider has to outlive that.
  const entryUnread = useRef<{ chatId: Id | null; count: number; lastReadId: Id | null }>({
    chatId: null,
    count: 0,
    lastReadId: null,
  })
  if (entryUnread.current.chatId !== chatId) {
    entryUnread.current = {
      chatId,
      count: chat?.unreadCount ?? 0,
      lastReadId: chat?.self.lastReadMessageId ?? null,
    }
  }

  const scroll = useThreadScroll({
    chatId,
    rows,
    unreadCount: entryUnread.current.count,
    lastReadMessageId: entryUnread.current.lastReadId,
    onRead: markReadUpTo,
  })

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
      setEditing(chatId, {
        messageId: message.id,
        body: message.body ?? '',
        hasMedia: message.media.length > 0,
      })
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

  /**
   * Pin or unpin — `forEveryone` picks between the chat-wide announcement and my
   * own private bookmark, which are separate pins on the same message.
   */
  const setPinned = useCallback(
    async (messageId: Id, pinned: boolean, forEveryone = true) => {
      if (chatId == null) return
      const ok = await pinMessage(chatId, messageId, pinned, forEveryone)
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
   * Delete ONE message straight from its context menu.
   *
   * The menu already knows which message it belongs to, so routing it through
   * selection mode only to delete a single row is a detour — the two ways of
   * deleting are named on the menu instead, and act at once.
   *
   * The id is dropped from any selection it was part of, or a selection bar
   * would go on counting a row that is no longer there.
   */
  const deleteMessage = useCallback(
    async (message: ChatMessage, forEveryone: boolean) => {
      if (chatId == null) return
      const ok = forEveryone
        ? await deleteForEveryone(chatId, [message.id])
        : await deleteForMe(chatId, [message.id])
      if (ok) setSelectedIds((held) => held.filter((id) => id !== message.id))
    },
    [chatId, deleteForEveryone, deleteForMe],
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
    scroll,
    isLoading,
    isLoadingMore,
    hasEarlier,
    loadEarlier,
    pinnedMessages,
    pinnedForEveryoneTotal,
    pinnedRows,
    pinTotal,
    isLoadingPins,
    isLoadingMorePins,
    hasMorePins,
    loadMorePins,
    typingNames,
    selfId,
    selectedIds,
    hasSelection: selectedIds.length > 0,
    canDeleteForEveryone,
    deleteMessage,
    toggleSelected,
    clearSelection,
    deleteSelected,
    startReply,
    startEditing,
    setPinned,
    forward,
  }
}
