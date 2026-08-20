import { useCallback, useEffect, useRef, useState } from 'react'
import { toastProblem } from '@/lib/api-toast'
import type { Id } from '@/types/api'
import { THREAD_JUMP_HIGHLIGHT_MS } from '../constants'
import { useHistorySeek } from './use-history-seek'

interface MessageJumpOptions {
  chatId: Id | null
  loadEarlier: () => Promise<void> | void
  hasEarlier: boolean
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
 */
export function useMessageJump({ chatId, loadEarlier, hasEarlier }: MessageJumpOptions) {
  const { ensureLoaded, isSeeking } = useHistorySeek({ chatId, loadEarlier, hasEarlier })
  const [target, setTarget] = useState<JumpTarget | null>(null)
  const [highlightedId, setHighlightedId] = useState<Id | null>(null)
  const nonceRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
  }

  // A jump belongs to the thread it was made in.
  useEffect(() => {
    clearTimer()
    setTarget(null)
    setHighlightedId(null)
  }, [chatId])

  useEffect(() => clearTimer, [])

  const jumpTo = useCallback(
    async (messageId: Id) => {
      const found = await ensureLoaded(messageId)
      if (!found) {
        toastProblem('That message is too far back to open from here.')
        return
      }

      nonceRef.current += 1
      setTarget({ messageId, nonce: nonceRef.current })
      setHighlightedId(messageId)

      clearTimer()
      timerRef.current = setTimeout(() => {
        setHighlightedId(null)
        timerRef.current = null
      }, THREAD_JUMP_HIGHLIGHT_MS)
    },
    [ensureLoaded],
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
