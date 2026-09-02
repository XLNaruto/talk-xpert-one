import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { VirtuosoHandle } from 'react-virtuoso'
import { isPageActive, subscribePageActive } from '@/hooks/use-page-active'
import { useChatStore } from '@/stores/chat-store'
import type { Id } from '@/types/api'
import {
  THREAD_AT_BOTTOM_THRESHOLD_PX,
  THREAD_AT_END_TOLERANCE_PX,
  THREAD_FIRST_ITEM_INDEX_BASE,
  THREAD_OPEN_SETTLE_MS,
  THREAD_PREPEND_HOLD_MS,
  THREAD_READ_SETTLE_MS,
} from '../constants'
import { traceScroll, traceScroller } from '../lib/thread-scroll-trace'
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
  /**
   * Sends the receipt, up to and including this message. `remainingUnread` is
   * what is still unread BELOW it, so the sidebar row can hold the rest rather
   * than being blanked by a read that stopped partway up a backlog.
   */
  onRead: (uptoMessageId: Id, remainingUnread: number) => void
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
  /** Watches the scroller's own box — see `onScrollerResize`. */
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const [isAtBottom, setAtBottom] = useState(true)
  /**
   * The same value in a ref, for the arrival effect below: it must decide with
   * what was true when the message landed, and a state read there would be a
   * render behind.
   */
  const atBottomRef = useRef(true)
  /**
   * Was the view on the end when the reader last touched the scroller?
   *
   * The SYNCHRONOUS answer to the question `atBottomRef` answers 50 ms late.
   * Virtuoso debounces `atBottomStateChange` by 50 ms, so for the first fiftieth
   * of a second after a flick upwards `atBottomRef` still says "at the bottom" —
   * and that is exactly the window a history page lands in, because the flick is
   * what asked for it. Every correction gated on `atBottomRef` alone therefore
   * fired mid-gesture and hauled the reader back down, one bounce per page.
   *
   * A `scroll` listener has no such lag: it runs in the gesture. It reads three
   * properties off the scroller and nothing else — the same three Virtuoso has
   * already read that frame — so it forces no layout of its own.
   *
   * Measured against the at-bottom THRESHOLD rather than `isAtEnd`'s sub-pixel
   * tolerance: this one has to survive the browser's own scroll anchoring
   * nudging the offset a pixel or two, where a reader who is plainly at the
   * bottom must never read as having left it.
   */
  const wasAtEndRef = useRef(true)
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
  /**
   * Has the READER taken hold of this thread — a wheel, a touch, a key, a drag
   * of the scrollbar?
   *
   * The gate on treating "at the bottom" as consent to leave the unread
   * divider, and it has to be the reader rather than anything measured off the
   * list. Every signal the list itself offers is spoofed by its own mount: for
   * the first frames it has laid out a single screenful of estimated rows, so
   * Virtuoso reports `atBottom: false` (nothing is rendered yet) and then
   * `atBottom: true` (there is nothing to scroll) before the reader has seen a
   * pixel. Both readings are honest and neither is about the reader.
   *
   * Taking them as consent unparked the divider, cleared the badge, sent a
   * receipt for the newest message and let the corrections pin the view to the
   * end — a chat with 119 unread opening on the newest message with the count
   * gone. "Was the view somewhere else first" does not survive that sequence
   * either, because the mount supplies the `false` all by itself.
   *
   * So the park is left alone until the reader moves, or until they ask for the
   * end outright with the jump-to-newest button, which unparks directly.
   */
  const readerTookOverRef = useRef(false)
  /**
   * True from the moment a jump is ASKED FOR until its scroll has landed.
   *
   * Distinct from `parked`, and the distinction is the whole bug: a jump to a
   * message outside the loaded window has to WALK history back to it first,
   * which is several requests and several prepends long. The reader is still
   * sitting at the bottom for all of it, so Virtuoso goes on reporting
   * `atBottom: true` — and `onAtBottomChange` reads that as "the reader is
   * caught up", clears the park, and hands every correction below permission to
   * pin the view to the end again. The jump then landed and was immediately
   * hauled back, twice, once per page that arrived: the flicker.
   *
   * So while this is set, being at the bottom is NOT taken as consent to follow.
   * It is cleared by `endJump` once the scroll has had its window.
   */
  const jumpingRef = useRef(false)
  /** False until the list has settled; gates read receipts. */
  const readyRef = useRef(false)
  const lastRangeRef = useRef<VisibleRange | null>(null)
  /**
   * The newest row's key as the last pass saw it — empty until a page lands.
   *
   * This is what tells an ARRIVAL apart from the thread simply OPENING. Both
   * change the newest row, and the open was being read as an arrival: the first
   * page landing fired a jump to the bottom and three corrective scrolls of its
   * own, on top of the ones the open settle was already making — six scrolls in
   * the first two seconds, which is a thread that fights the reader rather than
   * one that opens. Where a thread opens is `initialTopMostItemIndex`'s job, and
   * the unread divider depends on nothing here overruling it.
   */
  const newestKeyRef = useRef('')
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
  /**
   * Corrections stand down until this moment — see `THREAD_PREPEND_HOLD_MS`.
   *
   * A prepend is the one height change this hook must leave alone: Virtuoso is
   * already compensating for it, over two frames, and a correction landing
   * between them throws the view to the top of the list.
   */
  const prependHoldUntilRef = useRef(0)
  /**
   * Where the view was when the page landed, taken BEFORE the compensation
   * starts moving it — the position to restore once the hold expires. Read from
   * `wasAtEndRef` because that is the answer that has no 50 ms lag.
   */
  const prependWasAtEndRef = useRef(false)

  // Reset during render rather than in an effect: the anchor decides Virtuoso's
  // `initialTopMostItemIndex`, which is read on mount — an effect would run a
  // beat too late and the list would already have opened at the wrong place.
  if (anchorRef.current.chatId !== chatId) {
    anchorRef.current = { chatId, messageId: null, taken: false }
    readFrontierRef.current = lastReadMessageId
    sentUptoRef.current = lastReadMessageId
    parkedRef.current = false
    jumpingRef.current = false
    readyRef.current = false
    lastRangeRef.current = null
    newestKeyRef.current = ''
    openSettleUntilRef.current = Date.now() + THREAD_OPEN_SETTLE_MS
    firstItemIndexRef.current = THREAD_FIRST_ITEM_INDEX_BASE
    topRowIdRef.current = null
    prependHoldUntilRef.current = 0
    prependWasAtEndRef.current = false
    atBottomRef.current = true
    wasAtEndRef.current = true
    readerTookOverRef.current = false
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
      // A NEGATIVE find means the row that was top has gone from the array —
      // Virtuoso's index base is then out of step with the data, which is the
      // one thing that would make it draw rows at the wrong offsets.
      if (prepended > 0) {
        firstItemIndexRef.current -= prepended
        // Armed HERE rather than in an effect, for the same reason the index is
        // adjusted here: Virtuoso begins compensating in the pass that receives
        // the longer `data`, so a hold that starts a beat later starts after the
        // corrections it exists to hold back have already fired.
        // While the thread is still OPENING, "were we on the end" is the wrong
        // question and the deadline is the licence — the same rule
        // `onContentResize` follows. The first page is often a single screenful,
        // so `startReached` fires before the opening correction has even landed:
        // the view is legitimately several hundred pixels short at that moment,
        // and reading that as "the reader is up in history" left the release
        // with nothing to do and the thread parked a bubble short of the newest
        // message, jump-to-newest button and all.
        prependWasAtEndRef.current =
          wasAtEndRef.current || Date.now() <= openSettleUntilRef.current
        prependHoldUntilRef.current = Date.now() + THREAD_PREPEND_HOLD_MS
      }
    }
    topRowIdRef.current = topRowId
  }

  // Read once, here, because two things downstream need the same value: the
  // release effect below keys on it, and the list is handed it at the bottom.
  const firstItemIndexValue = firstItemIndexRef.current

  if (!anchorRef.current.taken && rows.length > 0) {
    // Two ways to find where reading stopped, and the SECOND is what makes this
    // survive a frontier that has run ahead of the badge.
    //
    // The frontier is the honest answer: the first row newer than the last id
    // the server recorded as read. But `last_read_message_id` can already name
    // the newest message while the row still counts unread — a receipt sent by
    // a copy of the app nobody was looking at, a mark-read that covered the
    // whole chat — and then no row qualifies, the divider never appears and the
    // reader is dropped at the bottom on top of sixty-three messages they have
    // not seen. So when the row says there is unread and the frontier disagrees,
    // the ROW is believed: count that many incoming messages back from the end.
    //
    // The divider is the one place a SYSTEM row does not count. It counts
    // everywhere else — the server puts it in `unread_count` and a receipt has
    // to name it — but "Unread messages" over "Goku created the group and added
    // you" is a banner over the only line a brand-new group contains, and it
    // stays up after the receipt has gone because the anchor is deliberately
    // frozen for the visit. A divider marks where reading stopped, and nobody
    // stopped reading above the line that made the conversation exist.
    let anchorIndex = rows.findIndex((row) => isDividerAnchor(row, lastReadMessageId))
    if (unreadCount > 0 && anchorIndex < 0) {
      let counted = 0
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        // Counting back uses the SERVER's rule — system lines included — or the
        // walk lands too far up the thread by however many of them there are.
        if (rows[i].isMine || rows[i].message.id < 0) continue
        anchorIndex = i
        counted += 1
        if (counted === unreadCount) break
      }
      // Then down again to the first row a divider may sit above. All system
      // lines and the block has no anchor at all, which is the new-group case.
      while (anchorIndex >= 0 && anchorIndex < rows.length && !isDividerAnchor(rows[anchorIndex], null)) {
        anchorIndex += 1
      }
      if (anchorIndex >= rows.length) anchorIndex = -1
      // The frontier is pulled back with it, or the badge would read zero while
      // the divider says otherwise — and `sentUpto` with it, or the receipts for
      // this run would be refused as already sent and the count would never
      // come down as the reader works through it.
      if (anchorIndex >= 0) {
        const previous = rows[anchorIndex - 1]?.message.id ?? null
        readFrontierRef.current = previous
        sentUptoRef.current = previous
      }
    }

    anchorRef.current = {
      chatId,
      messageId: unreadCount > 0 && anchorIndex >= 0 ? rows[anchorIndex].message.id : null,
      taken: true,
    }
    // Park only when there is something to park at. A read chat opens at the
    // bottom and follows arrivals from the first frame.
    parkedRef.current = anchorRef.current.messageId !== null
    // The decision, once per visit, with every input to it. Where a thread
    // OPENS is decided here and nowhere else: if this says the anchor is null
    // then nothing scrolled the view to the bottom — the list mounted there.
    traceScroll('anchor taken', {
      unreadCount,
      lastReadMessageId,
      rows: rows.length,
      anchorIndex,
      anchorId: anchorRef.current.messageId,
      parked: parkedRef.current,
      mineAtEnd: rows[rows.length - 1]?.isMine ?? null,
      oldestId: rows[0]?.message.id ?? null,
      newestId: rows[rows.length - 1]?.message.id ?? null,
    })
  }

  const unreadAnchorId = anchorRef.current.messageId

  const firstUnreadIndex = useMemo(() => {
    if (unreadAnchorId === null) return -1
    return rows.findIndex((row) => row.message.id === unreadAnchorId)
  }, [rows, unreadAnchorId])

  /**
   * Leave the divider — and say who decided to.
   *
   * The park is what keeps a thread on its unread divider, so every correction
   * in this hook reads it and a stray clear is invisible until the view is
   * already at the bottom. Routing all three releases through one function means
   * the trace names the culprit instead of the next reader inferring it.
   */
  const unpark = useCallback((reason: string) => {
    if (!parkedRef.current) return
    traceScroll(`unparked — ${reason}`)
    parkedRef.current = false
  }, [])

  /**
   * Where the list opens: the divider if there is one, otherwise the newest.
   *
   * The divider is aligned to the TOP so the unread run reads downward from it;
   * the caught-up case aligns to the END, or the last message would sit at the
   * top of the viewport with the rest of the pane empty beneath it.
   */
  const initialTopMostItemIndex = useMemo(
    () =>
      firstUnreadIndex >= 0
        ? firstUnreadIndex
        : { index: Math.max(rows.length - 1, 0), align: 'end' as const },
    [firstUnreadIndex, rows.length],
  )

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
    (behavior: 'smooth' | 'auto') => {
      traceScroll('scrollToEnd', { behavior })
      virtuosoRef.current?.scrollTo({ top: Number.MAX_SAFE_INTEGER, behavior })
    },
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

  /**
   * Is Virtuoso still moving the view to absorb a prepended page?
   *
   * While it is, every measurement this hook takes is of a position Virtuoso is
   * midway through changing, so the honest answer to "are we at the end" is
   * "ask again shortly".
   */
  const isAbsorbingPrepend = useCallback(() => Date.now() < prependHoldUntilRef.current, [])

  /** A correction that costs nothing when there is nothing to correct. */
  const scrollToEndIfNeeded = useCallback(
    () => {
      // Parked means the reader is somewhere else ON PURPOSE — at the unread
      // divider, or at a message they jumped to. Checked here as well as at
      // every call site, because the settle ladder fires from a timer and a
      // park that begins between scheduling it and its passes running would
      // otherwise be overridden by them.
      if (parkedRef.current) {
        traceScroll('correction skipped (parked)')
        return
      }
      if (isAtEnd()) {
        traceScroll('correction skipped (already at end)')
        return
      }
      scrollToEnd('auto')
    },
    [isAtEnd, scrollToEnd],
  )

  /**
   * Re-assert the end a few times while the list settles under it.
   *
   * One correction is never enough and the reason is always the same: the rows
   * are measured for the first time just AFTER whatever moved the view — a page
   * lands, a picture decodes, the composer regrows — so the end the correction
   * aimed at has moved by the time it gets there. Each pass costs nothing once
   * the view is genuinely at rest (`scrollToEndIfNeeded` measures first), and
   * they share `settleTimersRef` with everything else that schedules them, so a
   * newer intention always cancels an older one's remaining passes.
   */
  const settleToEnd = useCallback(() => {
    for (const timer of settleTimersRef.current) clearTimeout(timer)
    settleTimersRef.current = [120, 320, 600].map((delay) =>
      setTimeout(() => {
        traceScroll(`settle ${delay}ms`)
        scrollToEndIfNeeded()
      }, delay),
    )
  }, [scrollToEndIfNeeded])

  /**
   * Is the end within a screenful — i.e. are the last rows already mounted?
   *
   * The question `jumpToBottom` needs, and it is NOT `isAtEnd`. `scrollToIndex`
   * is only worth calling when the last row is out of play entirely: it aligns
   * the ITEM, which sits a footer short of the true bottom, and Virtuoso keeps
   * re-asserting that position for a few frames after the call. Fire it while
   * the end is already rendered and it drags the view back UP off the bottom,
   * and the settle timer below pushes it back down — the small bounce after
   * every arrival and every send. Within a viewport of the end, the plain
   * `scrollTo` past the end is exact on its own, so the index scroll is skipped.
   */
  const isNearEnd = useCallback(() => {
    const element = scrollerRef.current
    if (!element || element instanceof Window) return false
    const gap = element.scrollHeight - element.scrollTop - element.clientHeight
    return gap <= element.clientHeight
  }, [])

  const jumpToBottom = useCallback(
    (behavior: 'smooth' | 'auto' = 'auto') => {
      unpark('jump to bottom')
      for (const timer of settleTimersRef.current) clearTimeout(timer)

      // Only when the end is genuinely out of play — see `isNearEnd`.
      const nearEnd = isNearEnd()
      traceScroll('jumpToBottom', { behavior, nearEnd, indexScroll: !nearEnd })
      if (!nearEnd) {
        virtuosoRef.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior })
      }
      scrollToEnd(behavior)
      settleToEnd()
    },
    [isNearEnd, scrollToEnd, settleToEnd],
  )

  // Per chat as well as on unmount: `useThreadScroll` is not remounted when the
  // reader switches conversation, so a correction scheduled by the thread they
  // left — up to 600 ms of them — would otherwise land in the one they opened,
  // on top of that thread's own opening scroll.
  useEffect(
    () => () => {
      for (const timer of settleTimersRef.current) clearTimeout(timer)
      settleTimersRef.current = []
    },
    [chatId],
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
   * A jump to a specific message is starting — stop everything that pulls the
   * view back to the end.
   *
   * The corrections in this hook all assume the reader wants the newest message:
   * the open settle re-asserts the bottom on a ticker, a resize of the scroller
   * (the pinned bar appearing is one) does the same, and an arrival follows. A
   * jump means the opposite, and a smooth scroll gives all three a window to
   * fire in — which is how clicking the pinned bar ended up at the bottom
   * instead of at the pinned message. Parking is exactly the state for "the
   * reader is somewhere else on purpose", and reaching the end clears it.
   */
  const beginJump = useCallback(() => {
    parkedRef.current = true
    jumpingRef.current = true
    openSettleUntilRef.current = 0
    for (const timer of settleTimersRef.current) clearTimeout(timer)
    settleTimersRef.current = []
  }, [])

  /**
   * The jump is over — it landed, or it never found its message.
   *
   * Only the in-flight hold is released. The PARK is re-derived from where the
   * view actually ended up, which is the honest answer for both endings: a jump
   * that landed three screens up stays parked, because the reader is deliberately
   * elsewhere; a jump that failed moved nothing, so a reader still sitting at the
   * end goes back to following arrivals. Without that second half a failed jump
   * left the thread parked for good — silently, since nothing had moved to
   * explain why new messages had stopped scrolling into view.
   */
  const endJump = useCallback(() => {
    jumpingRef.current = false
    if (isAtEnd()) unpark('jump ended on the end')
  }, [isAtEnd])

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
    // The same gesture answers the other question this hook keeps asking: is
    // the reader driving? Until one of these has fired, every position the list
    // reports is a consequence of it laying itself out.
    readerTookOverRef.current = true
  }, [])

  /**
   * Dragging the SCROLLBAR is the fourth way to scroll, and it announces itself
   * as none of the three above — no wheel, no touch, no key, just a pointer on
   * the gutter and a stream of `scroll` events indistinguishable from our own
   * corrections. Left unhandled, the ticker fought the drag for the whole settle
   * window: the view was dragged up and hauled back down ten times a second.
   *
   * A press on the gutter lands on the scroller itself, past its content box —
   * `clientWidth` excludes the scrollbar, so an x beyond it is the gutter and
   * nothing else. Narrowed to that on purpose: a plain click on a bubble while
   * the thread is still opening must NOT abandon the correction, or the thread
   * parks a bubble short of the newest message, which is what the settle exists
   * to prevent.
   */
  const onPointerDown = useCallback(
    (event: Event) => {
      const element = scrollerRef.current
      if (!element || element instanceof Window) return
      const pointer = event as PointerEvent
      if (pointer.target !== element) return
      const x = pointer.clientX - element.getBoundingClientRect().left
      if (x >= element.clientWidth) abandonSettle()
    },
    [abandonSettle],
  )

  /**
   * The list got shorter or taller — hold the end if that is where we were.
   *
   * The thread is not the only thing in the pane: the pinned bar appears above
   * it the moment a message is pinned for everyone, the find bar opens, the
   * composer grows a line. Each takes height from the scroller, which keeps its
   * offset, so the conversation slides up under the reader. Re-asserting the end
   * is what makes the bar push the thread rather than scroll it.
   */
  const onScrollerResize = useCallback(() => {
    if (isAbsorbingPrepend()) {
      traceScroll('scroller resized — held (prepend)')
      return
    }
    traceScroll('scroller resized', {
      parked: parkedRef.current,
      jumping: jumpingRef.current,
      atBottom: atBottomRef.current,
      wasAtEnd: wasAtEndRef.current,
    })
    if (parkedRef.current) return
    if (jumpingRef.current) return
    // Both opinions, and the synchronous one is the tie-breaker — see
    // `wasAtEndRef`. The composer growing a line while the reader is up in
    // history must not be read as consent to jump to the newest message.
    if (!atBottomRef.current) return
    if (!wasAtEndRef.current) return
    scrollToEnd('auto')
  }, [isAbsorbingPrepend, scrollToEnd])

  /**
   * Record, in the gesture itself, whether the view is on the end.
   *
   * Bound to `scroll` rather than derived from Virtuoso's flag because the flag
   * is 50 ms behind — see `wasAtEndRef`. Our own corrections fire scroll events
   * too, which is exactly right: a correction that reached the end says so, and
   * one that was cancelled says that instead.
   */
  const rememberEnd = useCallback(() => {
    const element = scrollerRef.current
    if (!element || element instanceof Window) return
    // The compensation scrolls too, thousands of pixels at a time, and those
    // are not the reader moving: recording them leaves `wasAtEnd` false for a
    // view that never left the end, which switches off every correction that
    // depends on it for the rest of the visit.
    if (isAbsorbingPrepend()) {
      traceScroll('scroll event — held (prepend)')
      return
    }
    const gap = element.scrollHeight - element.scrollTop - element.clientHeight
    wasAtEndRef.current = gap <= THREAD_AT_BOTTOM_THRESHOLD_PX
    traceScroll('scroll event')
  }, [isAbsorbingPrepend])

  const onScrollerRef = useCallback(
    (element: HTMLElement | Window | null) => {
      const previous = scrollerRef.current
      if (previous && !(previous instanceof Window)) {
        previous.removeEventListener('wheel', abandonSettle)
        previous.removeEventListener('touchstart', abandonSettle)
        previous.removeEventListener('keydown', abandonSettle)
        previous.removeEventListener('pointerdown', onPointerDown)
        previous.removeEventListener('scroll', rememberEnd)
      }
      resizeObserverRef.current?.disconnect()
      resizeObserverRef.current = null

      scrollerRef.current = element
      traceScroller(element)
      if (element && !(element instanceof Window)) {
        if (typeof ResizeObserver !== 'undefined') {
          const observer = new ResizeObserver(onScrollerResize)
          observer.observe(element)
          resizeObserverRef.current = observer
        }
        element.addEventListener('wheel', abandonSettle, { passive: true })
        element.addEventListener('touchstart', abandonSettle, { passive: true })
        element.addEventListener('keydown', abandonSettle)
        element.addEventListener('pointerdown', onPointerDown, { passive: true })
        element.addEventListener('scroll', rememberEnd, { passive: true })
      }
    },
    [abandonSettle, onPointerDown, onScrollerResize, rememberEnd],
  )

  // The scroller can go away without Virtuoso handing back a null ref — an
  // unmount takes the whole tree with it — so the observer is disconnected here
  // as well as in the ref callback.
  useEffect(() => () => resizeObserverRef.current?.disconnect(), [])

  /**
   * The hold expires, and the view goes back where it was.
   *
   * Keyed on `firstItemIndex`, which changes only when a page prepends, so this
   * runs once per page. Nothing is corrected for a reader who was up in history
   * when it landed — the whole point of the compensation is that they stay put.
   */
  useEffect(() => {
    if (prependHoldUntilRef.current === 0) return
    const remaining = prependHoldUntilRef.current - Date.now()
    if (remaining <= 0) return
    const timer = setTimeout(() => {
      prependHoldUntilRef.current = 0
      if (!prependWasAtEndRef.current) return
      if (parkedRef.current || jumpingRef.current) return
      // Restored as well as re-scrolled: the gate above skipped every `scroll`
      // event of the compensation, so this is the first honest reading since
      // the page landed.
      wasAtEndRef.current = true
      traceScroll('prepend hold released')
      // The ladder, not a single scroll: the 149 rows that just arrived are
      // being measured for the first time right now, so the end moves for
      // several frames after the hold expires. One correction lands short of it
      // — which is the newest bubble half off the bottom of the pane, with the
      // jump-to-newest button sitting over it.
      scrollToEndIfNeeded()
      settleToEnd()
    }, remaining)
    return () => clearTimeout(timer)
  }, [firstItemIndexValue, scrollToEndIfNeeded, settleToEnd])

  /** Count what is unread BELOW the last rendered row — the badge's number. */
  const countUnreadBelow = useCallback(
    (range: VisibleRange | null) => {
      if (!range) return 0
      let count = 0
      // Clamped: a range that came back negative would otherwise walk the whole
      // array from below zero — a million dead iterations for a badge count.
      for (let i = Math.max(range.endIndex + 1, 0); i < rows.length; i++) {
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

  /**
   * The rows, for the imperative paths — `readUpTo` runs from a scroll handler
   * and from a focus listener, neither of which may close over a stale array.
   */
  const rowsRef = useRef(rows)
  rowsRef.current = rows

  /**
   * The array index of the last row whose element is inside the scroller.
   *
   * Virtuoso stamps `data-item-index` on every rendered row, in its OFFSET
   * space, so this is the one place that can answer "what does the reader
   * actually have on screen" — the rendered range cannot, and neither can a
   * scroll offset once rows have different heights. Null when nothing is
   * mounted yet, which reads as "trust the range".
   */
  const newestVisibleIndex = useCallback((): number | null => {
    const element = scrollerRef.current
    if (!element || element instanceof Window) return null
    const bottom = element.getBoundingClientRect().bottom
    const items = element.querySelectorAll<HTMLElement>('[data-item-index]')
    let newest: number | null = null
    for (const item of items) {
      // Its TOP being above the fold is enough: a half-visible bubble at the
      // bottom edge has been seen, and demanding the whole row would leave the
      // last message unread whenever it is taller than the gap.
      if (item.getBoundingClientRect().top >= bottom) break
      const index = Number(item.dataset.itemIndex)
      if (Number.isFinite(index)) newest = index - firstItemIndexRef.current
    }
    return newest
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
      // Everything newer than the receipt is still unread. Nothing older can
      // be: the server marks read UP TO the id, and the newest page is the one
      // we hold, so this is the whole remainder and not a sample of it.
      let remaining = 0
      for (let i = rowsRef.current.length - 1; i >= 0; i -= 1) {
        const row = rowsRef.current[i]
        if (row.message.id <= messageId) break
        if (isUnread(row, messageId)) remaining += 1
      }
      onRead(messageId, remaining)
    },
    [onRead],
  )

  /**
   * Act on a range that is ALREADY in array space — send the receipt for the
   * newest unread row on screen and recount the badge.
   *
   * Split out from `onRangeChanged` because the focus listener and the settle
   * timer replay `lastRangeRef`, which is stored in array space. Feeding that
   * back through the offset subtraction below took the indices a million
   * negative, which silently emptied the receipt loop and made the badge count
   * walk the entire index space — the 1.3 s `focus` handler.
   */
  const applyVisibleRange = useCallback(
    (visible: VisibleRange) => {
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

  // Keep a live handle on the latest version, so the settle timer and the
  // measuring frame below both run against the current rows rather than the ones
  // that were loaded when they were scheduled.
  const applyVisibleRangeRef = useRef(applyVisibleRange)
  applyVisibleRangeRef.current = applyVisibleRange

  /**
   * The newest range Virtuoso has reported but that has not been measured yet,
   * and the frame that will measure it.
   *
   * `rangeChanged` is called from inside Virtuoso's own scroll handler, and the
   * measurement below reads layout — the scroller's box and a rect per mounted
   * row — which forces the browser to lay the list out before it can answer.
   * Doing that in the scroll handler is what put `'scroll' handler took 231ms`
   * in the console: the frame is already gone by the time the handler returns,
   * so the list paints late and the reader sees the gap as a flicker.
   *
   * Nothing here has to be answered THIS tick — a read receipt and a badge
   * count are both fine one frame later — so the range is parked and measured
   * in a rAF, which runs after layout instead of forcing it. Several ranges
   * arriving in one frame collapse into the last, which is the only one whose
   * answer would have survived anyway.
   */
  const pendingRangeRef = useRef<VisibleRange | null>(null)
  const rangeFrameRef = useRef<number | null>(null)

  const measurePendingRange = useCallback(() => {
    rangeFrameRef.current = null
    const range = pendingRangeRef.current
    pendingRangeRef.current = null
    if (!range) return

    // Virtuoso reports the OFFSET index — `rows` position plus `firstItemIndex`
    // — so it has to come back down to an array index before anything here
    // indexes `rows` with it.
    const offset = firstItemIndexRef.current
    // ...and it reports the RENDERED range, which runs a screenful past the
    // viewport in both directions (`increaseViewportBy`). Rendered is not seen:
    // taking it at face value sent receipts for messages 600px below the fold
    // and left the badge with nothing to count. The last row that is genuinely
    // on screen is measured instead, and the range is clipped to it.
    const seenEnd = newestVisibleIndex()
    const rangeEnd = range.endIndex - offset
    applyVisibleRangeRef.current({
      startIndex: range.startIndex - offset,
      endIndex: seenEnd === null ? rangeEnd : Math.min(rangeEnd, seenEnd),
    })
  }, [newestVisibleIndex])

  const onRangeChanged = useCallback(
    (range: VisibleRange) => {
      pendingRangeRef.current = range
      if (rangeFrameRef.current !== null) return
      rangeFrameRef.current = requestAnimationFrame(measurePendingRange)
    },
    [measurePendingRange],
  )

  // A frame that fires after the thread has gone would measure a scroller that
  // is no longer on screen.
  useEffect(
    () => () => {
      if (rangeFrameRef.current !== null) cancelAnimationFrame(rangeFrameRef.current)
    },
    [],
  )

  const onAtBottomChange = useCallback(
    (atBottom: boolean) => {
      setAtBottom(atBottom)
      atBottomRef.current = atBottom
      // The socket handler needs this to decide whether an arriving message
      // lands in the reader's viewport — which is the whole test for whether it
      // counts as read.
      useChatStore.getState().setThreadAtBottom(atBottom)
      if (!atBottom) return
      // The list reporting the bottom is not the reader asking for it — see
      // `readerTookOverRef`. Nothing below may run on it: not the un-park, not
      // the badge, and above all not the receipt.
      if (parkedRef.current && !readerTookOverRef.current) {
        traceScroll('at-bottom ignored (reader has not moved yet)')
        return
      }
      // Reaching the bottom is the reader saying they are caught up — the park
      // ends and the whole thread counts as read.
      //
      // Unless a jump is on its way somewhere else: then the bottom is not where
      // the reader asked to be, it is only where they still are while the pages
      // between here and their target are fetched. Un-parking on it is what let
      // the corrections below pin the view back to the end mid-jump.
      if (!jumpingRef.current) unpark('reader reached the bottom')
      showUnreadBelow(0)
      const newest = rows[rows.length - 1]
      if (readyRef.current && newest && newest.message.id > 0) readUpTo(newest.message.id)
    },
    [rows, readUpTo, showUnreadBelow],
  )

  /**
   * Opening a chat sets the flag from the anchor: a thread parked at an unread
   * divider is not showing its newest message, so an arrival there is unread
   * like any other. Cleared on unmount — a thread nobody has open is nobody's
   * viewport.
   */
  useEffect(() => {
    const atBottom = unreadAnchorId === null
    atBottomRef.current = atBottom
    useChatStore.getState().setThreadAtBottom(atBottom)
    return () => useChatStore.getState().setThreadAtBottom(false)
  }, [chatId, unreadAnchorId])

  // Pay what was owed the moment the window is looked at again: the range the
  // list last reported is re-run, which sends one receipt for whatever is on
  // screen now. Blur needs no handling — `readUpTo` simply stops answering.
  useEffect(
    () =>
      subscribePageActive(() => {
        if (!isPageActive()) return
        if (!readyRef.current) return
        if (lastRangeRef.current) applyVisibleRangeRef.current(lastRangeRef.current)
      }),
    [],
  )

  // Open the receipt gate once Virtuoso has stopped moving, then run the range
  // it settled on — otherwise nothing is marked read until the user scrolls.
  useEffect(() => {
    readyRef.current = false
    const timer = setTimeout(() => {
      readyRef.current = true
      if (lastRangeRef.current) applyVisibleRangeRef.current(lastRangeRef.current)
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
  const newestIsMine = Boolean(newest?.isMine)
  const newestId = newest?.message.id ?? -1
  useEffect(() => {
    const previousKey = newestKeyRef.current
    newestKeyRef.current = newestKey
    traceScroll('newest row changed', {
      from: previousKey,
      to: newestKey,
      mine: newestIsMine,
      rows: rows.length,
    })
    // Nothing to follow yet — this is the opening page, not a new message.
    if (previousKey === '') return
    if (newestIsMine) {
      showUnreadBelow(0)
      jumpToBottom('auto')
      return
    }

    // SOMEBODY ELSE's message, and the reader is watching the end: followed
    // here, because Virtuoso's own `followOutput` is off — see the note on the
    // prop in `message-list.tsx`.
    //
    // It was consulted while the list was being TOLD about the new row, and what
    // it could measure at that moment was not always what the reader saw — which
    // is how an arrival ended up behind the scroll-to-bottom badge for someone
    // sitting at the bottom. This runs AFTER the row is in and uses the same
    // corrective jump the send does, so the answer does not depend on when it
    // was asked.
    if (parkedRef.current) return
    if (!atBottomRef.current) return
    // And the un-lagged answer as well. A message landing in the fiftieth of a
    // second after the reader flicked upwards was still being followed, because
    // that is how long Virtuoso takes to admit the view has left the bottom.
    if (!wasAtEndRef.current) return
    showUnreadBelow(0)
    jumpToBottom('auto')
    // Watched go past IS read, so the frontier moves with the view rather than
    // waiting for the next `rangeChanged` to notice. Without it the reader could
    // scroll up afterwards and be told those same messages were unread — which
    // is the count the badge was showing. `readUpTo` still refuses when the
    // window is not the one being looked at.
    if (readyRef.current && newestId > 0) readUpTo(newestId)
    // `newest` is intentionally absent — the key is what identifies a new row.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newestKey, newestIsMine, newestId, jumpToBottom, readUpTo, showUnreadBelow])

  /**
   * Hold the view on the true bottom while the list settles under it.
   *
   * This used to be a 100 ms ticker, and the ticker WAS the flicker. A poll can
   * only ever correct the frame AFTER the wrong one has been painted: the end
   * moves, the reader sees it move, and up to a tenth of a second later the view
   * is dragged back. Twenty-five times over the two and a half seconds a thread
   * takes to open, which is exactly the two-to-three seconds of juddering after
   * a refresh — and it stopped dead at the deadline because that is when the
   * ticker stopped, not because anything had settled.
   *
   * A `ResizeObserver` is the same correction with the timing fixed. It is
   * delivered after layout and BEFORE paint, in the frame the list actually
   * changed height in, so the reader never sees the intermediate position at
   * all. It also fires only when the end has genuinely moved, where the poll
   * asked twenty-five times and re-entered Virtuoso's scroll handler on every
   * answer.
   *
   * What it watches is the item list's BORDER box — Virtuoso pads that element
   * with the height of the rows it has not mounted, so its outer height is the
   * whole scrollable length. Measured as content instead, the number would
   * shuffle on every scroll as rows mount and unmount either side of the
   * viewport; measured as the border box, it moves only when a row is measured
   * for the first time, a font swaps, a page lands or a picture resolves — the
   * four things that move the end of a thread out from under the reader.
   *
   * It also replaces what Virtuoso's own `SIZE_INCREASED` follow used to do, and
   * that is deliberate: it does the same job behind the guards below, where the
   * library's version consulted nothing (see the `followOutput` note in
   * `message-list.tsx`).
   */
  const contentObserverRef = useRef<ResizeObserver | null>(null)

  const onContentResize = useCallback(() => {
    if (isAbsorbingPrepend()) {
      traceScroll('content resized — held (prepend)')
      return
    }
    traceScroll('content resized', {
      parked: parkedRef.current,
      jumping: jumpingRef.current,
      wasAtEnd: wasAtEndRef.current,
      opening: Date.now() <= openSettleUntilRef.current,
    })
    if (parkedRef.current) return
    if (jumpingRef.current) return
    // While the thread is still OPENING, the deadline is the licence and "were
    // we on the end" is the wrong question — the answer is no, and that is
    // precisely what is being corrected: the list opened a bubble short because
    // its rows were estimates. Once the window has closed it becomes the only
    // question, so a picture resolving three screens up never moves a reader
    // who is reading history.
    if (Date.now() > openSettleUntilRef.current && !wasAtEndRef.current) return
    scrollToEndIfNeeded()
  }, [isAbsorbingPrepend, scrollToEndIfNeeded])

  const hasRows = rows.length > 0

  useEffect(() => {
    if (!hasRows) return
    if (typeof ResizeObserver === 'undefined') return

    // Virtuoso publishes the scroller from an effect of its own and renders the
    // list into it a frame later, so NEITHER element is reliably there when this
    // runs. Both are re-read on every attempt rather than captured, and the
    // attempt is retried a frame at a time until they are — a single early miss
    // would otherwise cost the thread its correction for the whole visit.
    let frame: number | null = null
    // Bounded, so a list that never turns up costs a handful of frames rather
    // than a callback on every frame for as long as the chat stays open.
    let attemptsLeft = 60
    const attach = () => {
      frame = null
      if (attemptsLeft-- <= 0) return
      const element = scrollerRef.current
      const list =
        element && !(element instanceof Window)
          ? element.querySelector<HTMLElement>(VIRTUOSO_ITEM_LIST)
          : null
      if (!list) {
        frame = requestAnimationFrame(attach)
        return
      }
      const observer = new ResizeObserver(onContentResize)
      observer.observe(list, { box: 'border-box' })
      contentObserverRef.current = observer
    }
    attach()

    // The one correction the observer cannot make, because nothing has resized
    // by the time we get here: the opening one. `scrollToEndIfNeeded` is a
    // no-op when the list already opened on the end, and a null scroller reads
    // as "not on the end", so a genuine opening scroll still happens.
    onContentResize()

    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      contentObserverRef.current?.disconnect()
      contentObserverRef.current = null
    }
  }, [chatId, hasRows, onContentResize])

  // A message arriving while the reader is up in history never fires
  // `rangeChanged`, so the badge would sit stale. Recount against the range the
  // list last reported.
  useEffect(() => {
    if (isAtBottom) return
    showUnreadBelow(countUnreadBelow(lastRangeRef.current))
  }, [rows, isAtBottom, countUnreadBelow, showUnreadBelow])

  /**
   * Held stable, because this object is a PROP of the list.
   *
   * A fresh object here re-rendered `MessageList` on every render of the pane,
   * and Virtuoso republishes every one of its props into its own state on every
   * render it does — data, totalCount, firstItemIndex, the lot —
   * which recomputes the list state and re-arms the machinery that decides
   * whether to pin the view to the end. Opening a thread renders the pane
   * twenty-eight times in two seconds (the page lands, the chat row updates,
   * presence arrives, the socket connects), and each one was paying for that.
   * With this memoised and the list memo'd, only the renders that changed
   * something the list draws reach it.
   */
  const firstItemIndex = firstItemIndexValue
  return useMemo(
    () => ({
      virtuosoRef,
      onScrollerRef,
      /** Index of the divider row, or -1 when the chat opened fully read. */
      firstUnreadIndex,
      /** The message the divider sits above — frozen for this visit. */
      unreadAnchorId,
      initialTopMostItemIndex,
      /** Virtuoso's index for `rows[0]` — see `THREAD_FIRST_ITEM_INDEX_BASE`. */
      firstItemIndex,
      isAtBottom,
      unreadBelow,
      scrollToBottom,
      beginJump,
      endJump,
      onAtBottomChange,
      onRangeChanged,
    }),
    [
      onScrollerRef,
      firstUnreadIndex,
      unreadAnchorId,
      initialTopMostItemIndex,
      firstItemIndex,
      isAtBottom,
      unreadBelow,
      scrollToBottom,
      beginJump,
      endJump,
      onAtBottomChange,
      onRangeChanged,
    ],
  )
}

/**
 * Virtuoso's inner list — the element whose outer height is the whole
 * scrollable length of the thread. See `onContentResize`.
 */
const VIRTUOSO_ITEM_LIST = '[data-testid="virtuoso-item-list"]'

/**
 * Where the "Unread messages" rule may be drawn: an unread row that a PERSON
 * wrote. See the note at the call site for why a system line is not one.
 */
function isDividerAnchor(row: ThreadRow | undefined, frontier: Id | null): boolean {
  return isUnread(row, frontier) && row?.message.type !== 'system'
}

/** Anything not mine, newer than the frontier. My own never count. */
function isUnread(row: ThreadRow | undefined, frontier: Id | null): boolean {
  if (!row || row.isMine) return false
  // A negative id is an optimistic bubble of my own that has not been saved yet.
  if (row.message.id < 0) return false
  // A SYSTEM line counts. It belongs to the conversation rather than to a
  // person, which is why it is tempting to exclude — but the server counts it in
  // `unread_count`, and a brand-new group contains NOTHING ELSE: "Goku created
  // the group and added you" is the whole thread. Excluding it left no row a
  // receipt could name, so the badge sat on 1 with the chat open in front of the
  // reader and only a manual "mark as read" could shift it.
  return frontier === null || row.message.id > frontier
}
