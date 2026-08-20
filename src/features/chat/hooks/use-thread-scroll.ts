import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { VirtuosoHandle } from 'react-virtuoso'
import { isPageActive, subscribePageActive } from '@/hooks/use-page-active'
import type { Id } from '@/types/api'
import {
  THREAD_AT_END_TOLERANCE_PX,
  THREAD_FIRST_ITEM_INDEX_BASE,
  THREAD_OPEN_SETTLE_MS,
  THREAD_OPEN_SETTLE_TICK_MS,
  THREAD_READ_SETTLE_MS,
} from '../constants'
import type { ThreadRow } from './use-message-thread'

/** What Virtuoso hands back on `rangeChanged` — the rows currently rendered. */
interface VisibleRange {
  startIndex: number
  endIndex: number
}

interface ThreadScrollOptions {
  chatId: Id | null
  rows: ThreadRow[]
  /**
   * Unread as the SERVER counted it when the chat was opened. Only used to
   * decide whether to hunt for an unread anchor at all — a chat the server
   * calls read opens at the bottom, with no divider and no hunting.
   */
  unreadCount: number
  /** My read frontier from `chat.self`. Null when I have never read here. */
  lastReadMessageId: Id | null
  /** Sends the receipt, up to and including this message. */
  onRead: (uptoMessageId: Id) => void
}

/**
 * Where the thread sits, and what has actually been seen.
 *
 * Four behaviours that all turn on the same question — is the reader at the
 * bottom or back in history — so they are decided in one place rather than
 * fighting each other across three components:
 *
 * - **Opening stops at the first unread**, under a divider, instead of dropping
 *   the reader at the newest message past everything they have not read.
 * - **Read receipts are sent for what was actually on screen**, once the list
 *   has settled — never for the positions Virtuoso passes through on the way.
 * - **Arrivals only scroll the view when the reader is already at the bottom.**
 *   A burst landing while they read history bumps a badge instead.
 * - **Your own send always jumps to the bottom**, because you cannot be typing
 *   into a conversation and reading its history at the same time.
 */
export function useThreadScroll({
  chatId,
  rows,
  unreadCount,
  lastReadMessageId,
  onRead,
}: ThreadScrollOptions) {
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  /**
   * The scrolling element itself.
   *
   * Needed because the open-time correction below has to be able to ASK whether
   * it is already at the bottom. `VirtuosoHandle` can only command a scroll, and
   * a correction that cannot tell it has arrived has to keep firing blind.
   */
  const scrollerRef = useRef<HTMLElement | Window | null>(null)
  const [isAtBottom, setAtBottom] = useState(true)
  const [unreadBelow, setUnreadBelow] = useState(0)
  /**
   * The badge's number, mirrored in a ref.
   *
   * `rangeChanged` fires many times a second while scrolling, and the count it
   * arrives at is almost always the one already on screen. Setting state anyway
   * asks React for a render pass per scroll event — inside the scroll handler —
   * so the write is gated on the value having actually moved.
   */
  const unreadBelowRef = useRef(0)

  /**
   * The first unread message, FROZEN for as long as this chat stays open.
   *
   * It has to be frozen: the divider marks where the reader picked up, and
   * reading is exactly what erases the evidence of where that was. Recomputing
   * it would make the divider crawl down the screen and then vanish.
   */
  const anchorRef = useRef<{ chatId: Id | null; messageId: Id | null; taken: boolean }>({
    chatId: null,
    messageId: null,
    taken: false,
  })
  /** The newest id known to be read — the server's frontier, then ours. */
  const readFrontierRef = useRef<Id | null>(null)
  /** Highest id we have already sent a receipt for, so each is sent once. */
  const sentUptoRef = useRef<Id | null>(null)
  /** True while the view is parked at the divider — auto-follow stays off. */
  const parkedRef = useRef(false)
  /** False until the list has settled; gates read receipts. */
  const readyRef = useRef(false)
  const lastRangeRef = useRef<VisibleRange | null>(null)
  /** Skips the own-send jump on the very first render of a chat. */
  const mountedRef = useRef(false)
  /**
   * How long a freshly-opened, caught-up chat keeps re-asserting the bottom.
   *
   * `initialTopMostItemIndex` aligns the last ITEM, which is NOT the end of the
   * scroller: the footer sits past it, and every row's height is an estimate
   * until it has mounted and been measured. So the thread opened a bubble or two
   * short. One corrective scroll is not enough either — the cached rows are
   * swapped for a fresh page, heights settle, and media decodes, each of which
   * moves the end underneath us. Re-assert until this deadline, then stop.
   */
  const openSettleUntilRef = useRef(0)
  /**
   * Virtuoso's index for `rows[0]`, and the id it belonged to when we last
   * looked. See `THREAD_FIRST_ITEM_INDEX_BASE`: every message prepended above
   * the top row takes one off this, which is how Virtuoso is told a page landed
   * at the TOP — it compensates the scroll so the reader stays on the message
   * they were looking at, and it re-arms `startReached` for the next page.
   */
  const firstItemIndexRef = useRef(THREAD_FIRST_ITEM_INDEX_BASE)
  const topRowIdRef = useRef<Id | null>(null)

  // Reset during render rather than in an effect: the anchor decides Virtuoso's
  // `initialTopMostItemIndex`, which is read on mount — an effect would run a
  // beat too late and the list would already have opened at the wrong place.
  if (anchorRef.current.chatId !== chatId) {
    anchorRef.current = { chatId, messageId: null, taken: false }
    readFrontierRef.current = lastReadMessageId
    sentUptoRef.current = lastReadMessageId
    parkedRef.current = false
    readyRef.current = false
    lastRangeRef.current = null
    mountedRef.current = false
    openSettleUntilRef.current = Date.now() + THREAD_OPEN_SETTLE_MS
    firstItemIndexRef.current = THREAD_FIRST_ITEM_INDEX_BASE
    topRowIdRef.current = null
  }

  // Count what arrived ABOVE the row that used to be first, in render rather
  // than in an effect: Virtuoso reads `firstItemIndex` in the same pass that
  // receives the longer `data`, and a value that lands a beat late is read as a
  // bottom-append — which is exactly the jump this is here to prevent. A top
  // row that has gone missing (deleted for me) moves nothing.
  const topRowId = rows[0]?.message.id ?? null
  if (topRowId !== null && topRowId !== topRowIdRef.current) {
    if (topRowIdRef.current !== null) {
      const prepended = rows.findIndex((row) => row.message.id === topRowIdRef.current)
      if (prepended > 0) firstItemIndexRef.current -= prepended
    }
    topRowIdRef.current = topRowId
  }

  if (!anchorRef.current.taken && rows.length > 0) {
    anchorRef.current = {
      chatId,
      messageId:
        unreadCount > 0
          ? rows.find((row) => isUnread(row, lastReadMessageId))?.message.id ?? null
          : null,
      taken: true,
    }
    // Park only when there is something to park at. A read chat opens at the
    // bottom and follows arrivals from the first frame.
    parkedRef.current = anchorRef.current.messageId !== null
  }

  const unreadAnchorId = anchorRef.current.messageId

  const firstUnreadIndex = useMemo(() => {
    if (unreadAnchorId === null) return -1
    return rows.findIndex((row) => row.message.id === unreadAnchorId)
  }, [rows, unreadAnchorId])

  /**
   * Where the list opens: the divider if there is one, otherwise the newest.
   *
   * The divider is aligned to the TOP so the unread run reads downward from it;
   * the caught-up case aligns to the END, or the last message would sit at the
   * top of the viewport with the rest of the pane empty beneath it.
   */
  const initialTopMostItemIndex =
    firstUnreadIndex >= 0
      ? firstUnreadIndex
      : { index: Math.max(rows.length - 1, 0), align: 'end' as const }

  /**
   * Land on the TRUE bottom, not merely on the last row.
   *
   * `scrollToIndex` aligns the ITEM, which is not the same place: the footer
   * sits below it, and the row's height is an estimate until it has actually
   * mounted and been measured. Both leave the view short — which is why the
   * button stayed on screen after being clicked. So the index scroll is only
   * used to bring the row into play, and the real landing is a direct scroll
   * past the end of the scroller, which the browser clamps to the exact bottom.
   *
   * It is re-asserted a few times because the height keeps moving underneath:
   * the last row measures, an image decodes, the composer regrows. Each pass is
   * a no-op once the view is genuinely at rest.
   */
  const settleTimersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  /**
   * The one honest way to reach the end: scroll the scroller past it and let the
   * browser clamp. Independent of item heights, footers and estimates.
   */
  const scrollToEnd = useCallback(
    (behavior: 'smooth' | 'auto') =>
      virtuosoRef.current?.scrollTo({ top: Number.MAX_SAFE_INTEGER, behavior }),
    [],
  )

  /**
   * Whether the view is already sitting on the end.
   *
   * `scrollTop` is fractional on a fractional device pixel ratio while
   * `scrollHeight` is rounded, so the gap at a genuine bottom is rarely 0 — it
   * is some sub-pixel remainder. Asking for exactness means the answer is "not
   * yet" forever and every corrective scroll below fires anyway, which is a
   * flicker; asking with the `atBottomThreshold` slack means a two-dozen-pixel
   * shortfall reads as arrived, which leaves the newest bubble clipped. Hence a
   * tolerance of its own, sized to the sub-pixel remainder and nothing more.
   */
  const isAtEnd = useCallback(() => {
    const element = scrollerRef.current
    if (!element || element instanceof Window) return false
    const gap = element.scrollHeight - element.scrollTop - element.clientHeight
    return gap <= THREAD_AT_END_TOLERANCE_PX
  }, [])

  /** A correction that costs nothing when there is nothing to correct. */
  const scrollToEndIfNeeded = useCallback(() => {
    if (isAtEnd()) return
    scrollToEnd('auto')
  }, [isAtEnd, scrollToEnd])

  const jumpToBottom = useCallback(
    (behavior: 'smooth' | 'auto' = 'auto') => {
      parkedRef.current = false
      for (const timer of settleTimersRef.current) clearTimeout(timer)

      virtuosoRef.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior })
      scrollToEnd(behavior)
      settleTimersRef.current = [120, 320, 600].map((delay) =>
        setTimeout(scrollToEndIfNeeded, delay),
      )
    },
    [scrollToEnd, scrollToEndIfNeeded],
  )

  useEffect(
    () => () => {
      for (const timer of settleTimersRef.current) clearTimeout(timer)
    },
    [],
  )

  /**
   * The jump-to-newest button, and the send. Both land INSTANTLY.
   *
   * A smooth scroll here animates through the whole history between where you
   * were and the end — which reads as the thread flying past rather than as the
   * bottom arriving, and takes long enough that the first thing you see after
   * sending is motion instead of your own message. Both are deliberate acts with
   * a known destination, so they cut straight to it.
   */
  const scrollToBottom = useCallback(() => jumpToBottom('auto'), [jumpToBottom])

  /**
   * The reader has taken over — stop correcting the scroll.
   *
   * Bound to the input gestures rather than inferred from the list leaving the
   * bottom, because those are not the same event. Opening a thread moves the
   * list off the bottom constantly on its own: a row measures for the first
   * time, an image decodes, the composer grows. Treating any of those as "the
   * reader scrolled away" abandoned the correction while the view was still
   * short, which is how a freshly-opened thread ended up parked a bubble above
   * the newest message.
   */
  const abandonSettle = useCallback(() => {
    openSettleUntilRef.current = 0
  }, [])

  const onScrollerRef = useCallback(
    (element: HTMLElement | Window | null) => {
      const previous = scrollerRef.current
      if (previous && !(previous instanceof Window)) {
        previous.removeEventListener('wheel', abandonSettle)
        previous.removeEventListener('touchstart', abandonSettle)
        previous.removeEventListener('keydown', abandonSettle)
      }
      scrollerRef.current = element
      if (element && !(element instanceof Window)) {
        element.addEventListener('wheel', abandonSettle, { passive: true })
        element.addEventListener('touchstart', abandonSettle, { passive: true })
        element.addEventListener('keydown', abandonSettle)
      }
    },
    [abandonSettle],
  )

  /** Count what is unread BELOW the last rendered row — the badge's number. */
  const countUnreadBelow = useCallback(
    (range: VisibleRange | null) => {
      if (!range) return 0
      let count = 0
      for (let i = range.endIndex + 1; i < rows.length; i++) {
        if (isUnread(rows[i], readFrontierRef.current)) count++
      }
      return count
    },
    [rows],
  )

  /**
   * Send one receipt for the newest thing on screen.
   *
   * One request, not one per message: the server marks everything up to the id
   * as read, so a viewport holding thirty unread messages costs a single call.
   */
  const showUnreadBelow = useCallback((count: number) => {
    if (unreadBelowRef.current === count) return
    unreadBelowRef.current = count
    setUnreadBelow(count)
  }, [])

  const readUpTo = useCallback(
    (messageId: Id) => {
      if (sentUptoRef.current !== null && messageId <= sentUptoRef.current) return
      // Rendered is not read. A background tab or an unfocused window mounts the
      // same rows and reports the same visible range as the one being looked at,
      // so without this gate the copy nobody is watching marks every arrival
      // read on the reader's behalf. Nothing is recorded either — no frontier,
      // no `sentUpto` — so the receipt is still owed when the window comes back.
      if (!isPageActive()) return
      sentUptoRef.current = messageId
      readFrontierRef.current = messageId
      onRead(messageId)
    },
    [onRead],
  )

  const onRangeChanged = useCallback(
    (range: VisibleRange) => {
      // Virtuoso reports the OFFSET index — `rows` position plus
      // `firstItemIndex` — so it has to come back down to an array index before
      // anything here indexes `rows` with it.
      const offset = firstItemIndexRef.current
      const visible: VisibleRange = {
        startIndex: range.startIndex - offset,
        endIndex: range.endIndex - offset,
      }
      lastRangeRef.current = visible

      if (readyRef.current) {
        let newest: Id | null = null
        for (let i = Math.max(visible.startIndex, 0); i <= visible.endIndex && i < rows.length; i++) {
          const row = rows[i]
          if (isUnread(row, readFrontierRef.current)) newest = row.message.id
        }
        if (newest !== null) readUpTo(newest)
      }

      showUnreadBelow(countUnreadBelow(visible))
    },
    [rows, readUpTo, countUnreadBelow, showUnreadBelow],
  )

  // Keep a live handle on the latest version so the settle timer below can run
  // the range it captured before receipts were allowed.
  const onRangeChangedRef = useRef(onRangeChanged)
  onRangeChangedRef.current = onRangeChanged

  const onAtBottomChange = useCallback(
    (atBottom: boolean) => {
      setAtBottom(atBottom)
      if (!atBottom) return
      // Reaching the bottom is the reader saying they are caught up — the park
      // ends and the whole thread counts as read.
      parkedRef.current = false
      showUnreadBelow(0)
      const newest = rows[rows.length - 1]
      if (readyRef.current && newest && newest.message.id > 0) readUpTo(newest.message.id)
    },
    [rows, readUpTo, showUnreadBelow],
  )

  /**
   * Auto-follow, but only for a reader who is already at the bottom.
   *
   * This is what makes a burst of arrivals survivable: thirty messages landing
   * while someone reads last week's history move the badge, not the viewport.
   */
  const followOutput = useCallback((atBottom: boolean) => {
    if (parkedRef.current) return false
    // `true` is Virtuoso's instant follow. Deliberately NOT 'smooth': an arrival
    // while you sit at the bottom is a one-row nudge, and animating it competes
    // with the instant jump the send below has already started.
    return atBottom
  }, [])

  // Pay what was owed the moment the window is looked at again: the range the
  // list last reported is re-run, which sends one receipt for whatever is on
  // screen now. Blur needs no handling — `readUpTo` simply stops answering.
  useEffect(
    () =>
      subscribePageActive(() => {
        if (!isPageActive()) return
        if (!readyRef.current) return
        if (lastRangeRef.current) onRangeChangedRef.current(lastRangeRef.current)
      }),
    [],
  )

  // Open the receipt gate once Virtuoso has stopped moving, then run the range
  // it settled on — otherwise nothing is marked read until the user scrolls.
  useEffect(() => {
    readyRef.current = false
    const timer = setTimeout(() => {
      readyRef.current = true
      if (lastRangeRef.current) onRangeChangedRef.current(lastRangeRef.current)
    }, THREAD_READ_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [chatId])

  /**
   * Your own message always wins the scroll.
   *
   * Keyed on the optimistic bubble's `clientMessageId` as well as its id, so the
   * jump happens the instant the bubble appears rather than when the server's
   * row replaces it.
   */
  const newest = rows[rows.length - 1]
  const newestKey = newest
    ? `${newest.message.clientMessageId ?? ''}:${newest.message.id}`
    : ''
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true
      return
    }
    if (!newest?.isMine) return
    showUnreadBelow(0)
    jumpToBottom('auto')
    // `newest` is intentionally absent — the key is what identifies a new row.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newestKey, jumpToBottom])

  /**
   * Hold a caught-up chat at the true bottom while it opens.
   *
   * A ticker rather than a few scheduled corrections, because the things that
   * move the end of the list after the first scroll do not announce themselves
   * and do not change anything this hook can watch: the cached page is replaced
   * by a fetched one of the SAME length, row heights are measured for the first
   * time, an emoji font swaps in, an image decodes. Re-asserting on a timer for
   * a moment covers all of them without needing to know which one happened.
   *
   * Skipped when there is an unread divider to park at — that one is meant to
   * stop short of the end.
   */
  useEffect(() => {
    if (unreadAnchorId !== null) return
    if (rows.length === 0) return
    if (Date.now() > openSettleUntilRef.current) return

    // Gated from the very first pass too: this effect re-runs whenever a page
    // lands, and an unconditional scroll there would yank a reader who had
    // already moved. A null scroller reads as "not at the end", so the genuine
    // opening scroll still happens.
    scrollToEndIfNeeded()
    const ticker = setInterval(() => {
      if (Date.now() > openSettleUntilRef.current) {
        clearInterval(ticker)
        return
      }
      // Ticks to the deadline, because a late image decode or a font swap can
      // move the end after the list looked settled — but stays SILENT while
      // there is nothing to correct. Each needless scroll re-enters Virtuoso's
      // handler, and twenty-five of them over two and a half seconds is what a
      // freshly-opened thread was doing to itself.
      scrollToEndIfNeeded()
    }, THREAD_OPEN_SETTLE_TICK_MS)
    return () => clearInterval(ticker)
  }, [chatId, rows.length, unreadAnchorId, scrollToEndIfNeeded])

  // A message arriving while the reader is up in history never fires
  // `rangeChanged`, so the badge would sit stale. Recount against the range the
  // list last reported.
  useEffect(() => {
    if (isAtBottom) return
    showUnreadBelow(countUnreadBelow(lastRangeRef.current))
  }, [rows, isAtBottom, countUnreadBelow, showUnreadBelow])

  return {
    virtuosoRef,
    onScrollerRef,
    /** Index of the divider row, or -1 when the chat opened fully read. */
    firstUnreadIndex,
    /** The message the divider sits above — frozen for this visit. */
    unreadAnchorId,
    initialTopMostItemIndex,
    /** Virtuoso's index for `rows[0]` — see `THREAD_FIRST_ITEM_INDEX_BASE`. */
    firstItemIndex: firstItemIndexRef.current,
    isAtBottom,
    unreadBelow,
    scrollToBottom,
    followOutput,
    onAtBottomChange,
    onRangeChanged,
  }
}

/** Somebody else's message, newer than the frontier. My own never count. */
function isUnread(row: ThreadRow | undefined, frontier: Id | null): boolean {
  if (!row || row.isMine) return false
  // A negative id is an optimistic bubble of my own that has not been saved yet.
  if (row.message.id < 0) return false
  // A system line belongs to the conversation, not to a person, so it is never
  // somebody's unread message — including one whose event code we don't know.
  if (row.message.type === 'system') return false
  return frontier === null || row.message.id > frontier
}
