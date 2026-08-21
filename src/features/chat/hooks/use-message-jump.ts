import { useCallback, useEffect, useRef, useState } from 'react'
import { toastProblem } from '@/lib/api-toast'
import type { Id } from '@/types/api'
import { THREAD_JUMP_HIGHLIGHT_MS, THREAD_JUMP_SETTLE_MS } from '../constants'
import { useHistorySeek } from './use-history-seek'

interface MessageJumpOptions {
  chatId: Id | null
  loadEarlier: () => Promise<void> | void
  hasEarlier: boolean
  /**
   * The thread is leaving the end on purpose — hold off every correction that
   * pulls it back. Called BEFORE the history walk, not after: the walk is
   * several requests long and the corrections fire throughout it.
   */
  onJumpStart?: () => void
  /**
   * The jump is over, landed or not. Both endings must be reported: a failed
   * jump that never says so leaves the thread held off arrivals for good.
   */
  onJumpEnd?: () => void
}

/**
 * The target of a jump: the message id, plus a nonce.
 *
 * The nonce is what makes jumping to the SAME message twice a second event —
 * clicking the pin bar again after scrolling away has to move the view again,
 * and an id on its own would compare equal and do nothing.
 */
export interface JumpTarget {
  messageId: Id
  nonce: number
}

/**
 * Go to a message the reader pointed at from somewhere else.
 *
 * A pin, a reply quote and a pinned-list row all mean the same thing when
 * clicked: put the message they name on screen. The message may be far above the
 * loaded window, so history is walked back to it first (`useHistorySeek`), and
 * only then is the list told to scroll — a scroll to a row that isn't drawn goes
 * nowhere.
 *
 * The landing is banded for a moment so the eye can find it: a thread of similar
 * bubbles gives no other clue that the view moved to the right one. The band
 * expires on a timer rather than on the next scroll, because the reader may well
 * scroll immediately and would then never see it.
 *
 * The whole gesture is bracketed by `onJumpStart` / `onJumpEnd` rather than just
 * announced at the top, because the interesting part is the MIDDLE. A target
 * outside the loaded window is reached by walking history back to it a page at a
 * time, and the reader is still sitting at the bottom for every one of those
 * pages — so the thread has to be told to stop correcting for the duration, not
 * merely warned before it starts.
 */
export function useMessageJump({
  chatId,
  loadEarlier,
  hasEarlier,
  onJumpStart,
  onJumpEnd,
}: MessageJumpOptions) {
  const { ensureLoaded, isSeeking, isSeekingNow } = useHistorySeek({
    chatId,
    loadEarlier,
    hasEarlier,
  })
  const [target, setTarget] = useState<JumpTarget | null>(null)
  const [highlightedId, setHighlightedId] = useState<Id | null>(null)
  const nonceRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The callbacks come from a component and change identity every render. They
  // are read at the END of an async walk, so a ref is the only way the walk
  // reports back to the current thread rather than to the one it started in.
  const startRef = useRef(onJumpStart)
  startRef.current = onJumpStart
  const endRef = useRef(onJumpEnd)
  endRef.current = onJumpEnd

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
  }

  /** Release the hold — once, whoever gets here first. */
  const releaseHold = useCallback(() => {
    if (settleTimerRef.current) {
      clearTimeout(settleTimerRef.current)
      settleTimerRef.current = null
    }
    endRef.current?.()
  }, [])

  // A jump belongs to the thread it was made in — and so does its hold, which
  // must not outlive the thread that is waiting on it.
  useEffect(() => {
    clearTimer()
    releaseHold()
    setTarget(null)
    setHighlightedId(null)
  }, [chatId, releaseHold])

  useEffect(
    () => () => {
      clearTimer()
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
    },
    [],
  )

  const jumpTo = useCallback(
    async (messageId: Id) => {
      // A walk is already on its way somewhere. A second one cannot overtake it —
      // `ensureLoaded` refuses it — and starting one anyway would hand back the
      // hold the first jump is still relying on, which is the flicker all over
      // again for anybody who double-clicks a reply quote.
      if (isSeekingNow()) return

      // Before the walk, not after it. Everything that pulls the view back to
      // the end fires WHILE history is being paged in.
      releaseHold()
      startRef.current?.()

      const found = await ensureLoaded(messageId)
      if (!found) {
        // Nothing moved, so the hold is handed straight back — otherwise the
        // thread sits held off arrivals with no jump to show for it.
        releaseHold()
        toastProblem('That message is too far back to open from here.')
        return
      }

      nonceRef.current += 1
      setTarget({ messageId, nonce: nonceRef.current })
      setHighlightedId(messageId)

      // The scroll itself is the list's job and it corrects itself for a moment
      // after landing, so the hold outlasts that window rather than ending with
      // this function.
      settleTimerRef.current = setTimeout(() => {
        settleTimerRef.current = null
        endRef.current?.()
      }, THREAD_JUMP_SETTLE_MS)

      clearTimer()
      timerRef.current = setTimeout(() => {
        setHighlightedId(null)
        timerRef.current = null
      }, THREAD_JUMP_HIGHLIGHT_MS)
    },
    [ensureLoaded, isSeekingNow, releaseHold],
  )

  return {
    /** Scroll here. Carries a nonce so repeating a jump still counts as one. */
    target,
    /** Band this row until the timer expires. */
    highlightedId,
    /** True while history is being pulled back to reach the target. */
    isSeeking,
    jumpTo,
  }
}
