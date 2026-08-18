import { useState } from 'react'
import { MessagesSquare, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/common/empty-state'
import { useSendMessage } from '../api/use-send-message'
import { useMessageThread } from '../hooks/use-message-thread'
import { useThreadSearch } from '../hooks/use-thread-search'
import { formatTypingLine } from '../lib/message-formatters'
import { ChatHeader } from './chat-header'
import { ChatDetailsSheet } from './chat-details-sheet'
import { ForwardDialog } from './forward-dialog'
import { MessageInfoDialog } from './message-info-dialog'
import { MessageInput } from './message-input'
import { MessageList } from './message-list'
import { MessageListSkeleton } from './message-list-skeleton'
import { PinnedBar } from './pinned-bar'
import { ThreadSearchBar } from './thread-search-bar'
import type { Chat, ChatMessage } from '../types'
import type { Id } from '@/types/api'

/** The open thread: header, pin bar, log, composer, and the sheets they open. */
export function ChatArea({ chat }: { chat: Chat | null }) {
  const {
    rows,
    isLoading,
    isLoadingMore,
    hasEarlier,
    loadEarlier,
    pinnedMessages,
    typingNames,
    selfId,
    selectedIds,
    hasSelection,
    canDeleteForEveryone,
    toggleSelected,
    clearSelection,
    deleteSelected,
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

  const { retry } = useSendMessage()
  const [showDetails, setShowDetails] = useState(false)
  const [forwarding, setForwarding] = useState<Id[] | null>(null)
  const [infoMessageId, setInfoMessageId] = useState<Id | null>(null)

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
    <section className="flex h-full min-w-0 flex-1 flex-col bg-background">
      <ChatHeader
        chat={chat}
        onOpenDetails={() => setShowDetails(true)}
        onOpenSearch={search.isOpen ? search.close : search.open}
        isSearchOpen={search.isOpen}
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

      <PinnedBar
        messages={pinnedMessages}
        onUnpin={(messageId) => void setPinned(messageId, false)}
      />

      {/* The selection bar offers "for everyone" only when every ticked message
          is mine — anyone may hide anything, but only the sender may withdraw. */}
      {hasSelection && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-secondary/60 px-3 py-2">
          <span className="flex-1 text-xs">{selectedIds.length} selected</span>
          <Button variant="ghost" size="sm" onClick={() => setForwarding(selectedIds)}>
            Forward
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void deleteSelected(false)}>
            <Trash2 />
            Delete for me
          </Button>
          {canDeleteForEveryone && (
            <Button variant="ghost" size="sm" onClick={() => void deleteSelected(true)}>
              Delete for everyone
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={clearSelection} aria-label="Cancel">
            <X />
          </Button>
        </div>
      )}

      {isLoading ? (
        <MessageListSkeleton />
      ) : (
        <MessageList
          rows={rows}
          isGroup={chat.type === 'group'}
          selfTalkUserId={selfId}
          hasEarlier={hasEarlier}
          isLoadingMore={isLoadingMore}
          onLoadEarlier={loadEarlier}
          selectedIds={selectedIds}
          hasSelection={hasSelection}
          onToggleSelected={toggleSelected}
          onReply={startReply}
          onEdit={startEditing}
          onDelete={(message: ChatMessage) => toggleSelected(message.id)}
          onPin={(messageId, pinned) => void setPinned(messageId, pinned)}
          onForward={(message) => setForwarding([message.id])}
          onShowInfo={(message) => setInfoMessageId(message.id)}
          onRetry={(message) => void retry(message)}
          activeSearchMessageId={search.isOpen ? search.activeMessageId : null}
          searchHitIds={search.isOpen ? search.hitMessageIds : undefined}
        />
      )}

      {typingNames.length > 0 && (
        <p className="shrink-0 px-4 pb-1 text-xs text-primary" aria-live="polite">
          {formatTypingLine(typingNames)}
        </p>
      )}

      <MessageInput chat={chat} />

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
