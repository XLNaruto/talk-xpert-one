import { useCallback, useEffect, useMemo } from 'react'
import { Loader2 } from 'lucide-react'
import { Virtuoso } from 'react-virtuoso'
import { EmptyState } from '@/components/common/empty-state'
import { cn } from '@/lib/utils'
import type { Id } from '@/types/api'
import { THREAD_AT_BOTTOM_THRESHOLD_PX, THREAD_OVERSCAN_PX } from '../constants'
import { formatDayDivider } from '../lib/message-formatters'
import type { ThreadRow } from '../hooks/use-message-thread'
import type { JumpTarget } from '../hooks/use-message-jump'
import type { useThreadScroll } from '../hooks/use-thread-scroll'
import type { ChatMessage } from '../types'
import { DayDivider } from './day-divider'
import { MessageBubble } from './message-bubble'
import { ScrollToBottomButton } from './scroll-to-bottom-button'
import { UnreadDivider } from './unread-divider'

interface MessageListProps {
  rows: ThreadRow[]
  /**
   * Everything about where the list sits — see `use-thread-scroll.ts`. Passed in
   * rather than called here so the thread's own hook and the composer's send can
   * both reach the same list.
   */
  scroll: ReturnType<typeof useThreadScroll>
  selfTalkUserId: Id | null
  hasEarlier: boolean
  isLoadingMore: boolean
  onLoadEarlier: () => void
  selectedIds: Id[]
  hasSelection: boolean
  onToggleSelected: (messageId: Id) => void
  onReply: (message: ChatMessage) => void
  onEdit: (message: ChatMessage) => void
  onDelete: (message: ChatMessage, forEveryone: boolean) => void
  onPin: (messageId: Id, pinned: boolean, forEveryone: boolean) => void
  onForward: (message: ChatMessage) => void
  onShowInfo: (message: ChatMessage) => void
  onRetry: (message: ChatMessage) => void
  /** The search hit to scroll to and band. Null when the find bar is closed. */
  activeSearchMessageId?: Id | null
  /** Every match in view, for the softer tint on the ones not stepped to. */
  searchHitIds?: Id[]
  /** Where a pin, a pinned-list row or a reply quote asked the view to land. */
  jumpTarget?: JumpTarget | null
  /** The landed-on message, banded until its timer expires. */
  jumpHighlightId?: Id | null
  /** Clicking a reply quote goes to the message it points at. */
  onJumpToMessage?: (messageId: Id) => void
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
  scroll,
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
  jumpTarget = null,
  jumpHighlightId = null,
  onJumpToMessage,
}: MessageListProps) {
  const {
    virtuosoRef,
    onScrollerRef,
    unreadAnchorId,
    initialTopMostItemIndex,
    firstItemIndex,
    isAtBottom,
    unreadBelow,
    scrollToBottom,
    followOutput,
    onAtBottomChange,
    onRangeChanged,
  } = scroll

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
    // `firstItemIndex` puts Virtuoso's indices in a different space from the
    // array's: `rows[0]` is index `firstItemIndex`, not 0. Every imperative
    // scroll has to be translated, or it lands a page's worth away.
    virtuosoRef.current?.scrollToIndex({
      index: firstItemIndex + index,
      align: 'center',
      behavior: 'smooth',
    })
  }, [activeSearchMessageId, rows, firstItemIndex, virtuosoRef])

  /**
   * Land on a message somebody pointed at from outside the thread.
   *
   * Keyed on the target's NONCE, not its id: clicking the same pin twice has to
   * move the view both times, and the row it names may only get an index once
   * `useMessageJump` has pulled the page holding it — hence `rows` in the deps
   * as well.
   */
  const jumpNonce = jumpTarget?.nonce ?? null
  const jumpMessageId = jumpTarget?.messageId ?? null
  useEffect(() => {
    if (jumpMessageId === null) return
    const index = rows.findIndex((row) => row.message.id === jumpMessageId)
    if (index < 0) return
    virtuosoRef.current?.scrollToIndex({
      index: firstItemIndex + index,
      align: 'center',
      behavior: 'smooth',
    })
    // `jumpMessageId` rides along with the nonce, which is what identifies a jump.
  }, [jumpNonce, jumpMessageId, rows, firstItemIndex, virtuosoRef])

  // Membership is asked once per rendered row per frame, so both of these are
  // sets rather than the arrays the props carry — an `includes` over a hundred
  // hits, thirty rows deep, inside a scroll handler is the shape of a jank.
  const hitIds = useMemo(() => new Set(searchHitIds ?? []), [searchHitIds])
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])

  // Virtuoso re-renders a row whenever `itemContent` changes identity, and the
  // same goes for anything in `components` — an inline arrow there is a NEW
  // component type each render, which remounts the header and footer outright.
  // Both are held stable so a scroll frame re-renders nothing it need not.
  const itemContent = useCallback(
    (_index: number, row: ThreadRow) => (
      // The band spans the full row rather than tinting the bubble: a hit has
      // to be findable while scrolling past it, and a bubble is only as wide
      // as its text.
      <div
        className={cn(
          'transition-colors',
          row.message.id === activeSearchMessageId || row.message.id === jumpHighlightId
            ? 'bg-primary/15'
            : hitIds.has(row.message.id) && 'bg-primary/5',
        )}
      >
        {row.newDay && <DayDivider label={formatDayDivider(row.message.createdAt)} />}
        {row.message.id === unreadAnchorId && <UnreadDivider />}
        <MessageBubble
          message={row.message}
          isMine={row.isMine}
          startsGroup={row.startsGroup}
          // Every incoming run is headed by its author — in a direct chat too,
          // so a thread reads the same wherever you opened it from. Only above
          // the FIRST bubble of a run; the rest sit under the spacer.
          showAuthor={row.startsGroup && !row.isMine}
          selfTalkUserId={selfTalkUserId}
          isSelected={hasSelection ? selectedSet.has(row.message.id) : null}
          onToggleSelected={onToggleSelected}
          onReply={onReply}
          onEdit={onEdit}
          onDelete={onDelete}
          onPin={onPin}
          onForward={onForward}
          onShowInfo={onShowInfo}
          onRetry={onRetry}
          onJumpToMessage={onJumpToMessage}
        />
      </div>
    ),
    [
      activeSearchMessageId,
      jumpHighlightId,
      hitIds,
      unreadAnchorId,
      selfTalkUserId,
      hasSelection,
      selectedSet,
      onToggleSelected,
      onReply,
      onEdit,
      onDelete,
      onPin,
      onForward,
      onShowInfo,
      onRetry,
      onJumpToMessage,
    ],
  )

  const components = useMemo(
    () => ({
      Header: () =>
        isLoadingMore ? (
          <div className="flex justify-center py-3">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : null,
      Footer: ListFooter,
    }),
    [isLoadingMore],
  )

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No messages yet"
        description="Say something to start this conversation."
      />
    )
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <Virtuoso
        ref={virtuosoRef}
        scrollerRef={onScrollerRef}
        className="min-h-0 flex-1"
        // An estimate, so the first pass mounts roughly the right number of rows
        // instead of filling the viewport with tiny placeholders and correcting.
        defaultItemHeight={64}
        // A screenful of rows kept mounted above and below, so a fast scroll
        // does not outrun the renderer and show bare background.
        increaseViewportBy={THREAD_OVERSCAN_PX}
        data={rows}
        // Tells Virtuoso that an older page landed above rather than below, so
        // it compensates the scroll instead of throwing the reader up into it —
        // and so `startReached` re-arms for the page after this one.
        firstItemIndex={firstItemIndex}
        followOutput={followOutput}
        initialTopMostItemIndex={initialTopMostItemIndex}
        atBottomStateChange={onAtBottomChange}
        atBottomThreshold={THREAD_AT_BOTTOM_THRESHOLD_PX}
        rangeChanged={onRangeChanged}
        startReached={hasEarlier ? onLoadEarlier : undefined}
        computeItemKey={computeItemKey}
        components={components}
        itemContent={itemContent}
      />

      <ScrollToBottomButton
        isVisible={!isAtBottom}
        unreadCount={unreadBelow}
        onClick={scrollToBottom}
      />
    </div>
  )
}

/**
 * Keyed on the message id, so a merge that re-sorts the array reuses rows
 * instead of remounting every bubble. Module-level, so its identity never
 * changes.
 */
function computeItemKey(_index: number, row: ThreadRow): Id {
  return row.message.id
}

const ListFooter = () => <div className="h-2" />
