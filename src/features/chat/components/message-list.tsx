import { useEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { EmptyState } from '@/components/common/empty-state'
import { cn } from '@/lib/utils'
import type { Id } from '@/types/api'
import { formatDayDivider } from '../lib/message-formatters'
import type { ThreadRow } from '../hooks/use-message-thread'
import type { ChatMessage } from '../types'
import { DayDivider } from './day-divider'
import { MessageBubble } from './message-bubble'

interface MessageListProps {
  rows: ThreadRow[]
  isGroup: boolean
  selfTalkUserId: Id | null
  hasEarlier: boolean
  isLoadingMore: boolean
  onLoadEarlier: () => void
  selectedIds: Id[]
  hasSelection: boolean
  onToggleSelected: (messageId: Id) => void
  onReply: (message: ChatMessage) => void
  onEdit: (message: ChatMessage) => void
  onDelete: (message: ChatMessage) => void
  onPin: (messageId: Id, pinned: boolean) => void
  onForward: (message: ChatMessage) => void
  onShowInfo: (message: ChatMessage) => void
  onRetry: (message: ChatMessage) => void
  /** The search hit to scroll to and band. Null when the find bar is closed. */
  activeSearchMessageId?: Id | null
  /** Every match in view, for the softer tint on the ones not stepped to. */
  searchHitIds?: Id[]
}

/**
 * The virtualised thread.
 *
 * `react-virtuoso` handles the part of a chat log that is genuinely hard: staying
 * pinned to the bottom as messages arrive while older pages prepend above without
 * the scroll position jumping.
 */
export function MessageList({
  rows,
  isGroup,
  selfTalkUserId,
  hasEarlier,
  isLoadingMore,
  onLoadEarlier,
  selectedIds,
  hasSelection,
  onToggleSelected,
  onReply,
  onEdit,
  onDelete,
  onPin,
  onForward,
  onShowInfo,
  onRetry,
  activeSearchMessageId = null,
  searchHitIds,
}: MessageListProps) {
  const virtuoso = useRef<VirtuosoHandle>(null)

  /**
   * Scroll the stepped-to search hit into view.
   *
   * Imperative because the list is virtualised: the target row may not be
   * mounted, so there is no element to call `scrollIntoView` on — only Virtuoso
   * can put an index on screen. It runs when the id changes AND when the rows
   * change, because a hit deep in history only gets an index once the page that
   * holds it has landed.
   */
  useEffect(() => {
    if (activeSearchMessageId === null) return
    const index = rows.findIndex((row) => row.message.id === activeSearchMessageId)
    if (index < 0) return
    virtuoso.current?.scrollToIndex({ index, align: 'center', behavior: 'smooth' })
  }, [activeSearchMessageId, rows])

  const hits = searchHitIds

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No messages yet"
        description="Say something to start this conversation."
      />
    )
  }

  return (
    <Virtuoso
      ref={virtuoso}
      className="min-h-0 flex-1"
      data={rows}
      followOutput="smooth"
      initialTopMostItemIndex={rows.length - 1}
      startReached={hasEarlier ? onLoadEarlier : undefined}
      // Keyed on the message id, so a merge that re-sorts the array reuses rows
      // instead of remounting every bubble.
      computeItemKey={(_index, row) => row.message.id}
      components={{
        Header: () =>
          isLoadingMore ? (
            <div className="flex justify-center py-3">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : null,
        Footer: () => <div className="h-2" />,
      }}
      itemContent={(_index, row) => (
        // The band spans the full row rather than tinting the bubble: a hit has
        // to be findable while scrolling past it, and a bubble is only as wide
        // as its text.
        <div
          className={cn(
            'transition-colors',
            row.message.id === activeSearchMessageId
              ? 'bg-primary/15'
              : hits?.includes(row.message.id) && 'bg-primary/5',
          )}
        >
          {row.newDay && <DayDivider label={formatDayDivider(row.message.createdAt)} />}
          <MessageBubble
            message={row.message}
            isMine={row.isMine}
            startsGroup={row.startsGroup}
            // The author's name and avatar are only useful where more than two
            // people speak, and only above the first bubble of a run.
            showAuthor={isGroup && row.startsGroup && !row.isMine}
            selfTalkUserId={selfTalkUserId}
            isSelected={hasSelection ? selectedIds.includes(row.message.id) : null}
            onToggleSelected={onToggleSelected}
            onReply={onReply}
            onEdit={onEdit}
            onDelete={onDelete}
            onPin={onPin}
            onForward={onForward}
            onShowInfo={onShowInfo}
            onRetry={onRetry}
          />
        </div>
      )}
    />
  )
}
