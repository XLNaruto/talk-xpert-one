import { useCallback, useState } from 'react'
import { Forward, Loader2, MessagesSquare, Trash2, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/common/empty-state'
import { useChatStore } from '@/stores/chat-store'
import { keyOf } from '@/types/api'
import { useSendMessage } from '../api/use-send-message'
import { useAttachments } from '../hooks/use-attachments'
import { useFileDrop } from '../hooks/use-file-drop'
import { useMessageJump } from '../hooks/use-message-jump'
import { useMessageThread } from '../hooks/use-message-thread'
import { useThreadSearch } from '../hooks/use-thread-search'
import { composerBlockedReason } from '../lib/chat-labels'
import { formatTypingLine } from '../lib/message-formatters'
import { ChatHeader } from './chat-header'
import { ChatDetailsSheet } from './chat-details-sheet'
import { ForwardDialog } from './forward-dialog'
import { MessageInfoDialog } from './message-info-dialog'
import { MessageInput } from './message-input'
import { MessageList } from './message-list'
import { MessageListSkeleton } from './message-list-skeleton'
import { PinnedBar } from './pinned-bar'
import { PinnedMessagesSheet } from './pinned-messages-sheet'
import { ThreadSearchBar } from './thread-search-bar'
import type { Chat, ChatMessage } from '../types'
import type { Id } from '@/types/api'

/** The open thread: header, pin bar, log, composer, and the sheets they open. */
export function ChatArea({ chat }: { chat: Chat | null }) {
  const {
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
    hasSelection,
    canDeleteForEveryone,
    toggleSelected,
    clearSelection,
    deleteSelected,
    deleteMessage,
    startReply,
    startEditing,
    setPinned,
    forward,
  } = useMessageThread(chat)

  const search = useThreadSearch({
    chatId: chat?.id ?? null,
    loadEarlier,
    hasEarlier,
  })

  // A pin, a pinned-list row and a reply quote all mean "put that message on
  // screen", so they share one jump — including the walk back through history
  // when the target is older than the loaded window.
  const jump = useMessageJump({
    chatId: chat?.id ?? null,
    loadEarlier,
    hasEarlier,
  })

  const { retry } = useSendMessage()

  // The whole pane takes a drop, not just the composer — a file aimed at the
  // conversation lands wherever it is let go. It still ends up in the composer's
  // attachment strip, so the send is one deliberate act, never a drop that
  // posts on its own.
  const chatId = chat?.id ?? null
  const { addFiles } = useAttachments(chatId)
  const editingHere = useChatStore((s) =>
    chatId == null ? null : s.editing[keyOf(chatId)] ?? null,
  )
  const blockedIds = useChatStore((s) => s.blockedTalkUserIds)
  // An edit carries no attachments and a closed composer cannot presign, so in
  // both cases there is nowhere for a file to go — better to refuse the drop
  // than to promise one and swallow it.
  const { isDragging, isFetchingLink, dragHandlers } = useFileDrop(addFiles, {
    disabled: Boolean(editingHere) || composerBlockedReason(chat, blockedIds) !== null,
  })

  const [showDetails, setShowDetails] = useState(false)
  const [showPins, setShowPins] = useState(false)
  const [forwarding, setForwarding] = useState<Id[] | null>(null)
  const [infoMessageId, setInfoMessageId] = useState<Id | null>(null)

  // The per-bubble handlers are hoisted into `useCallback`s rather than written
  // inline on `<MessageList>`: `MessageBubble` is memo'd, and a fresh arrow on
  // every render of this pane would re-render every mounted bubble on every
  // scroll frame — which is the whole cost the memo exists to avoid.
  const onDeleteMessage = useCallback(
    (message: ChatMessage, forEveryone: boolean) => void deleteMessage(message, forEveryone),
    [deleteMessage],
  )
  const onPinMessage = useCallback(
    (messageId: Id, pinned: boolean, forEveryone: boolean) =>
      void setPinned(messageId, pinned, forEveryone),
    [setPinned],
  )
  const onForwardMessage = useCallback((message: ChatMessage) => setForwarding([message.id]), [])
  const onShowMessageInfo = useCallback((message: ChatMessage) => setInfoMessageId(message.id), [])
  const onRetryMessage = useCallback((message: ChatMessage) => void retry(message), [retry])

  if (!chat) {
    return (
      <EmptyState
        icon={<MessagesSquare className="size-8" />}
        title="Pick a conversation"
        description="Choose someone from the list to read and reply."
      />
    )
  }

  return (
    <section
      className="relative flex h-full min-w-0 flex-1 flex-col bg-background"
      {...dragHandlers}
    >
      <ChatHeader
        chat={chat}
        onOpenDetails={() => setShowDetails(true)}
        onOpenSearch={search.isOpen ? search.close : search.open}
        isSearchOpen={search.isOpen}
        onOpenPins={() => setShowPins(true)}
        pinCount={pinTotal}
      />

      {search.isOpen && (
        <ThreadSearchBar
          query={search.query}
          onQueryChange={search.setQuery}
          position={search.position}
          total={search.total}
          isSearching={search.isSearching}
          isSeeking={search.isSeeking}
          onPrevious={search.goPrevious}
          onNext={search.goNext}
          onClose={search.close}
        />
      )}

      {/* One pin at a time, clicked through in order; the whole list is a
          button away. */}
      <PinnedBar
        messages={pinnedMessages}
        total={pinnedForEveryoneTotal}
        onOpenAll={() => setShowPins(true)}
        onJump={(messageId) => void jump.jumpTo(messageId)}
        onUnpin={(messageId) => void setPinned(messageId, false, true)}
      />

      {/* The selection bar offers "for everyone" only when every ticked message
          is mine — anyone may hide anything, but only the sender may withdraw. */}
      {hasSelection && (
        // Cancel leads, the way it does in every selection mode — the way out is
        // the first thing found. The two deletes are grouped and tinted
        // destructive, so the one that cannot be undone never sits a pixel from
        // Forward wearing the same clothes.
        <div className="flex shrink-0 items-center gap-1 border-b border-border bg-secondary/70 px-2 py-1.5">
          <Button variant="ghost" size="icon" onClick={clearSelection} aria-label="Cancel selection">
            <X />
          </Button>
          <span className="flex-1 truncate text-sm font-medium">
            {selectedIds.length} selected
          </span>

          <Button variant="ghost" size="sm" onClick={() => setForwarding(selectedIds)}>
            <Forward />
            Forward
          </Button>

          <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />

          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => void deleteSelected(false)}
          >
            <Trash2 />
            Delete for me
          </Button>
          {canDeleteForEveryone && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => void deleteSelected(true)}
            >
              Delete for everyone
            </Button>
          )}
        </div>
      )}

      {/* The walk back through history can take a few pages, and a click that
          appears to do nothing reads as broken. It belongs at the TOP of the
          thread, where the older pages are actually landing. */}
      {jump.isSeeking && (
        <p className="flex shrink-0 items-center justify-center gap-2 px-4 py-1 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" aria-hidden />
          Loading earlier messages…
        </p>
      )}

      {isLoading ? (
        <MessageListSkeleton />
      ) : (
        <MessageList
          // Remounted per conversation: `initialTopMostItemIndex` is read once,
          // at mount, and it is what lands the reader on their first unread.
          key={chat.id}
          rows={rows}
          scroll={scroll}
          selfTalkUserId={selfId}
          hasEarlier={hasEarlier}
          isLoadingMore={isLoadingMore}
          onLoadEarlier={loadEarlier}
          selectedIds={selectedIds}
          hasSelection={hasSelection}
          onToggleSelected={toggleSelected}
          onReply={startReply}
          onEdit={startEditing}
          onDelete={onDeleteMessage}
          onPin={onPinMessage}
          onForward={onForwardMessage}
          onShowInfo={onShowMessageInfo}
          onRetry={onRetryMessage}
          activeSearchMessageId={search.isOpen ? search.activeMessageId : null}
          searchHitIds={search.isOpen ? search.hitMessageIds : undefined}
          jumpTarget={jump.target}
          jumpHighlightId={jump.highlightedId}
          onJumpToMessage={(messageId) => void jump.jumpTo(messageId)}
        />
      )}

      {typingNames.length > 0 && (
        <p className="shrink-0 px-4 pb-1 text-xs text-primary" aria-live="polite">
          {formatTypingLine(typingNames)}
        </p>
      )}

      <MessageInput chat={chat} />

      {/* Covers the thread, the header and the composer alike, so the target is
          the conversation itself. `pointer-events-none` keeps the drop landing
          on the section underneath rather than on the hint. */}
      {isDragging && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-primary/60 px-8 py-12 text-center">
            <span className="flex size-14 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Upload className="size-6" aria-hidden />
            </span>
            <p className="text-base font-semibold">
              {isFetchingLink ? 'Fetching the image' : 'Drop files here'}
            </p>
            <p className="text-xs text-muted-foreground">
              {isFetchingLink
                ? 'It lands in the composer as an attachment.'
                : 'Images, videos and documents, up to 25 MB each'}
            </p>
          </div>
        </div>
      )}

      {showPins && (
        <PinnedMessagesSheet
          rows={pinnedRows}
          total={pinTotal}
          selfTalkUserId={selfId}
          isLoading={isLoadingPins}
          isLoadingMore={isLoadingMorePins}
          hasMore={hasMorePins}
          onLoadMore={() => void loadMorePins()}
          onUnpin={(messageId, forEveryone) => void setPinned(messageId, false, forEveryone)}
          onJump={(messageId) => {
            setShowPins(false)
            void jump.jumpTo(messageId)
          }}
          onClose={() => setShowPins(false)}
        />
      )}

      {showDetails && (
        <ChatDetailsSheet chat={chat} onClose={() => setShowDetails(false)} />
      )}

      {forwarding && (
        <ForwardDialog
          messageIds={forwarding}
          fromChatId={chat.id}
          onForward={async (messageIds, toChatIds) => {
            const ok = await forward(messageIds, toChatIds)
            if (ok) clearSelection()
            return ok
          }}
          onClose={() => setForwarding(null)}
        />
      )}

      {infoMessageId !== null && (
        <MessageInfoDialog
          chatId={chat.id}
          messageId={infoMessageId}
          onClose={() => setInfoMessageId(null)}
        />
      )}
    </section>
  )
}
