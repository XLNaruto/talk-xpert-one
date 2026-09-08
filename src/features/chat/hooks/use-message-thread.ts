import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { useChatStore } from '@/stores/chat-store'
import type { Id } from '@/types/api'
import { useMessages } from '../api/use-messages'
import { useMessageActions } from '../api/use-message-actions'
import { usePins } from '../api/use-pins'
import { startsNewDay, startsNewGroup } from '../lib/message-formatters'
import { withQuoteMedia, quoteMedia } from '../lib/quote-preview'
import { useTypingNames } from './use-typing'
import { useThreadScroll } from './use-thread-scroll'
import type { Chat, ChatMessage, MessageQuote, PinnedMessage } from '../types'

/**
 * One row plus everything it was derived FROM — see `rowCache`. Held so a rebuild
 * can prove a row is still current instead of computing it again.
 */
interface CachedRow {
  row: ThreadRow
  message: ChatMessage
  previous: ChatMessage | undefined
  following: ChatMessage | undefined
  quoted: ChatMessage | undefined
  selfId: Id | null
}

/** One rendered row: the message plus the flags the list needs to lay it out. */
export interface ThreadRow {
  message: ChatMessage
  /**
   * The message's own quote, with the attachment filled in from the thread's
   * copy of what it points at — see `withQuoteMedia`. Null when it is not a
   * reply. Kept beside the message rather than merged into it so the bubble's
   * `memo` still holds.
   */
  replyTo: MessageQuote | null
  /** First of a run by the same person — gets the spacing and the author name. */
  startsGroup: boolean
  /**
   * Last of that run — the bubble whose corner un-squares again, and the one the
   * spacing below the run hangs off. Read from the NEXT message rather than the
   * previous one, which is why it cannot be derived inside the bubble.
   */
  endsGroup: boolean
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
  const { messages, isLoading, isLoadingMore, hasEarlier, loadEarlier, loadEarlierNow } =
    useMessages(chatId)
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
  const {
    markRead,
    setPinned: pinMessage,
    deleteForEveryone,
    deleteForMe,
    deleteMedia,
    forward,
  } = useMessageActions()
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
   * The rows a previous pass already worked out, keyed by message id.
   *
   * A row is a pure function of five things — the message, the two rows either
   * side of it (the run and the day divider are decided by comparison), the
   * message its quote points at, and who I am. All five are immutable objects,
   * so identity is a sound test for "nothing that decides this row has changed".
   */
  const rowCache = useRef(new Map<Id, CachedRow>())

  /**
   * Precompute the per-row flags once, so the virtualised row renderer stays
   * cheap — it runs on every scroll frame.
   *
   * Rebuilt INCREMENTALLY, which is the difference between a message arriving
   * and the thread stalling. Every socket event — an arrival, a read receipt, an
   * edit — hands this a new `messages` array, and deriving nine hundred rows
   * from scratch each time cost hundreds of milliseconds on the main thread
   * while the list was trying to scroll. An arrival only actually changes two
   * rows: its own, and the one above it, whose run now has something after it.
   *
   * Reusing the row OBJECT matters as much as skipping the work: `MessageBubble`
   * is memo'd on it, so a row that comes back identical re-renders nothing.
   */
  const rows = useMemo<ThreadRow[]>(() => {
    // The server's `reply_to` is a summary with no attachments, so a reply's
    // quote is filled in from the message it points at where the thread holds
    // it. Built once per change rather than per row: a chat of five hundred
    // messages would otherwise be a scan per reply.
    const byId = new Map(messages.map((message) => [message.id, message]))
    const held = rowCache.current
    const fresh = new Map<Id, CachedRow>()

    const built = messages.map((message, index) => {
      const previous = messages[index - 1]
      const following = messages[index + 1]
      const quoted = message.replyTo ? byId.get(message.replyTo.id) : undefined

      const cached = held.get(message.id)
      if (
        cached &&
        cached.message === message &&
        cached.previous === previous &&
        cached.following === following &&
        cached.quoted === quoted &&
        cached.selfId === selfId
      ) {
        fresh.set(message.id, cached)
        return cached.row
      }

      const row: ThreadRow = {
        message,
        // Kept beside the message rather than merged into it: cloning the
        // message would hand `MessageBubble` a new object on every arrival and
        // cost every reply in the thread a re-render.
        replyTo: message.replyTo ? withQuoteMedia(message.replyTo, quoted) : null,
        startsGroup: startsNewGroup(message, previous),
        // The run ends here when whatever follows opens a new one — and at the
        // bottom of the log, where nothing follows yet. A row can be both the
        // start and the end of its run: a message on its own.
        endsGroup: following === undefined || startsNewGroup(following, message),
        newDay: startsNewDay(message, previous),
        isMine: message.senderTalkUserId === selfId,
      }
      fresh.set(message.id, { row, message, previous, following, quoted, selfId })
      return row
    })

    // Only what this pass actually holds, so a chat that is paged away or a
    // message deleted for me takes its entry with it.
    rowCache.current = fresh
    return built
  }, [messages, selfId])

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
    (uptoMessageId: Id, remainingUnread: number) => {
      if (chatId == null || uptoMessageId < 0) return
      markRead([chatId], uptoMessageId, remainingUnread)
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
        // Taken from the message being replied to, which we plainly hold: the
        // composer's bar draws the photo the moment "Reply" is chosen, with
        // nothing to look up and nothing to wait for.
        ...quoteMedia(message.media),
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
   * Take FILES off one message — the sender's own gesture, and the only delete
   * that leaves the rest of a bubble standing.
   *
   * Nothing is dropped from the selection here: the message survives the removal
   * unless it was a captionless bubble losing its last file, and in that case it
   * survives as a tombstone, which is still a row a selection may legitimately
   * hold.
   */
  const deleteMessageMedia = useCallback(
    async (messageId: Id, mediaIds: Id[]) => {
      if (chatId == null) return null
      return deleteMedia(chatId, messageId, mediaIds)
    },
    [chatId, deleteMedia],
  )

  /**
   * The ticked rows themselves, and only the ones actually loaded.
   *
   * A selected id with no message behind it — a row paged out from under the
   * selection — is dropped, and the count no longer matching `selectedIds` is
   * what makes both gates below refuse: neither action may be offered over a row
   * nobody can inspect.
   */
  const selectedMessages = useMemo(() => {
    if (selectedIds.length === 0) return []
    const byId = new Map(messages.map((m) => [m.id, m]))
    return selectedIds.map((id) => byId.get(id)).filter((m): m is ChatMessage => !!m)
  }, [selectedIds, messages])

  const isWholeSelectionLoaded =
    selectedMessages.length > 0 && selectedMessages.length === selectedIds.length

  /**
   * Whether "delete for everyone" may be offered.
   *
   * Anyone may hide anything they can see, but only the sender can withdraw a
   * message from other people — so a selection holding somebody ELSE's message
   * gets the "for me" option alone rather than a button that would half fail.
   *
   * A tombstone is refused for a second reason: the message is already withdrawn
   * from everyone, so there is nothing left to withdraw. What remains is the row
   * in MY list, and hiding that is exactly "delete for me" — which is why a
   * ticked "This message was deleted" is left with that one action, the same as
   * its own context menu offers.
   */
  const canDeleteForEveryone = useMemo(
    () =>
      isWholeSelectionLoaded &&
      selectedMessages.every(
        (m) => m.senderTalkUserId === selfId && !m.isDeletedForEveryone,
      ),
    [isWholeSelectionLoaded, selectedMessages, selfId],
  )

  /**
   * Whether the selection can be forwarded.
   *
   * A withdrawn message has no body and no attachments to carry anywhere, so
   * forwarding one would send an empty message. The bubble's own menu already
   * withholds Forward over a tombstone; the bar agrees.
   */
  const canForwardSelection = useMemo(
    () => isWholeSelectionLoaded && selectedMessages.every((m) => !m.isDeletedForEveryone),
    [isWholeSelectionLoaded, selectedMessages],
  )

  return {
    rows,
    scroll,
    isLoading,
    isLoadingMore,
    hasEarlier,
    loadEarlier,
    /** The same walk without the between-pages rest — for a SEEK, not a scroll. */
    loadEarlierNow,
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
    canForwardSelection,
    deleteMessage,
    deleteMessageMedia,
    toggleSelected,
    clearSelection,
    deleteSelected,
    startReply,
    startEditing,
    setPinned,
    forward,
  }
}
