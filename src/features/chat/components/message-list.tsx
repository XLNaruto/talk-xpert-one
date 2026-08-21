import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { Virtuoso } from 'react-virtuoso'
import { EmptyState } from '@/components/common/empty-state'
import { cn } from '@/lib/utils'
import type { Id } from '@/types/api'
import {
  THREAD_AT_BOTTOM_THRESHOLD_PX,
  THREAD_JUMP_CENTRE_WINDOW_MS,
  THREAD_JUMP_RETRY_MS,
  THREAD_JUMP_WAIT_CAP_MS,
  THREAD_OVERSCAN_PX,
} from '../constants'
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
   * The rows and the index base, for the ticker below.
   *
   * Held in refs rather than closed over, which is the whole point: the ticker
   * has to see the page that lands AFTER it started, and a callback that changed
   * identity every time `rows` did made the effects using it re-fire on every
   * cache write — restarting the scroll from scratch each time, and going on
   * doing it long after the jump had landed.
   */
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const firstItemIndexRef = useRef(firstItemIndex)
  firstItemIndexRef.current = firstItemIndex

  /**
   * Put one row in the middle of the viewport, and KEEP it there for a moment.
   *
   * Imperative because the list is virtualised: the target may not be mounted,
   * so there is nothing to call `scrollIntoView` on — only Virtuoso can put an
   * index on screen.
   *
   * Three things it has learnt the hard way.
   *
   * It scrolls INSTANTLY: a smooth scroll to a row several screens away is a
   * long animation that anything touching the scroller cancels, and a cancelled
   * one leaves the reader wherever they were — at the bottom, most of the time,
   * which looked like the jump doing nothing.
   *
   * It re-asserts on a ticker, because the rows between here and there are
   * measured for the first time as they mount: every correction moves the
   * target, and the first landing is an estimate. It stops as soon as the row is
   * actually on screen.
   *
   * And it WAITS for a row that isn't drawn yet instead of returning. This
   * function is called once per jump now, so a bare `return` on a missing index
   * meant a target whose page landed one render later was never scrolled to at
   * all. The ticker only starts spending its window once the row exists.
   */
  const scrollRowIntoView = useCallback(
    (messageId: Id) => {
      let ticker: ReturnType<typeof setInterval> | null = null
      /** When the row first became drawable — the centring window starts here. */
      let foundAt: number | null = null
      const waitUntil = Date.now() + THREAD_JUMP_WAIT_CAP_MS

      /** One correction. True once the row is genuinely in the middle band. */
      const attempt = (): boolean => {
        const index = rowsRef.current.findIndex((row) => row.message.id === messageId)
        if (index < 0) return false
        if (foundAt === null) foundAt = Date.now()

        /**
         * TWO index spaces, and they are not interchangeable.
         *
         * `scrollToIndex` takes the position in `data` — it CLAMPS what it is
         * given to `0..totalCount - 1`. `firstItemIndex` is a large base (a
         * million here) that Virtuoso adds when it STAMPS a row, so
         * `data-item-index`, `rangeChanged` and `initialTopMostItemIndex`
         * callbacks speak the offset space while the scroll method speaks the
         * array's.
         *
         * Handing the offset index to `scrollToIndex` therefore clamped every
         * jump to the last row — which is why a pin, a reply quote and a search
         * hit all scrolled to the BOTTOM instead of to the message. It is also
         * why the base is re-read every pass: a page prepending mid-jump moves
         * it, and a stamped index from before the prepend points at a row that
         * has since slid down the list.
         */
        const stamped = firstItemIndexRef.current + index
        if (isRowCentred(stamped)) return true

        /**
         * Virtuoso puts the row in play; the ELEMENT then puts itself in the
         * middle. `scrollToIndex` works off estimated heights and lands
         * approximately, and every correction after it moves the row again — so
         * the last word belongs to the row's own rectangle, which cannot be
         * approximate.
         */
        const element = rowElement(stamped)
        if (element) element.scrollIntoView({ block: 'center' })
        else virtuosoRef.current?.scrollToIndex({ index, align: 'center' })
        return false
      }

      const stop = () => {
        if (ticker) clearInterval(ticker)
        ticker = null
      }

      if (attempt()) return undefined

      ticker = setInterval(() => {
        if (attempt()) {
          stop()
          return
        }
        // Two ways to run out: the row never turned up, or it turned up and we
        // have spent long enough failing to centre it. Either way, stop — a
        // ticker that keeps scrolling is indistinguishable from the flicker it
        // was added to fix.
        const spent =
          foundAt === null
            ? Date.now() > waitUntil
            : Date.now() - foundAt > THREAD_JUMP_CENTRE_WINDOW_MS
        if (spent) stop()
      }, THREAD_JUMP_RETRY_MS)

      return stop
    },
    [virtuosoRef],
  )

  /**
   * The stepped-to search hit. Keyed on the id alone — the wait for a hit deep
   * in history is the ticker's job now, not a re-run's.
   */
  useEffect(() => {
    if (activeSearchMessageId === null) return
    return scrollRowIntoView(activeSearchMessageId)
  }, [activeSearchMessageId, scrollRowIntoView])

  /**
   * Land on a message somebody pointed at from outside the thread.
   *
   * Keyed on the target's NONCE and nothing else: clicking the same pin twice
   * has to move the view both times, so the nonce is what identifies a jump —
   * and `rows` is deliberately NOT here. It used to be, so that a target whose
   * page had not landed yet got another chance when it did; but the effect then
   * re-fired on every cache write for the rest of the thread's life, and each
   * re-fire dragged the view back to a message the reader had long since scrolled
   * away from. Waiting for the row is the ticker's job.
   */
  const jumpNonce = jumpTarget?.nonce ?? null
  const jumpMessageId = jumpTarget?.messageId ?? null
  useEffect(() => {
    if (jumpMessageId === null) return
    return scrollRowIntoView(jumpMessageId)
    // `jumpMessageId` rides along with the nonce, which is what identifies a jump.
  }, [jumpNonce, jumpMessageId, scrollRowIntoView])

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
          replyTo={row.replyTo}
          isMine={row.isMine}
          startsGroup={row.startsGroup}
          endsGroup={row.endsGroup}
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

/** The rendered row for a Virtuoso index, if it is mounted. */
function rowElement(index: number): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-item-index="${index}"]`)
}

/**
 * Is that row sitting in the MIDDLE band of the scroller?
 *
 * Not merely "on screen": Virtuoso renders a screenful past the viewport in
 * both directions, and a row half a screen below the fold is drawn but not
 * looked at. Asking for the middle third is what stops the ticker as soon as the
 * jump has actually arrived, and keeps correcting while it has not.
 */
function isRowCentred(index: number): boolean {
  const element = rowElement(index)
  if (!element) return false
  const scroller = element.closest<HTMLElement>('[data-testid="virtuoso-scroller"]')
  const bounds = scroller?.getBoundingClientRect()
  if (!bounds) return false
  const row = element.getBoundingClientRect()
  const centre = row.top + row.height / 2
  const margin = bounds.height * 0.15
  return centre > bounds.top + margin && centre < bounds.bottom - margin
}

/**
 * Keyed so a merge that re-sorts the array reuses rows instead of remounting
 * every bubble. Module-level, so its identity never changes.
 *
 * `clientMessageId` comes FIRST for a message of my own: the optimistic bubble
 * carries a negative id, and reconciling it with the server's row would change
 * the key — remounting the bubble, and with it the picture inside, which is what
 * made a sent image blink out and back. The id is what everything else is keyed
 * on, and it survives the swap because `adopt` keeps the client id on the row.
 */
function computeItemKey(_index: number, row: ThreadRow): Id | string {
  return row.message.clientMessageId ?? row.message.id
}

const ListFooter = () => <div className="h-2" />
