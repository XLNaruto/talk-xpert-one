import { useCallback, useEffect, useState } from 'react'
import type { Id } from '@/types/api'
import type { ChatMessage } from '../types'

/**
 * Which pin the bar is showing, and what clicking it does next.
 *
 * The bar carries ONE pin at a time — it sits above the thread and must not eat
 * it — so the way through a conversation with several pins is to step: click,
 * land on that pin, and the bar moves on to the next one down. It wraps, so a
 * reader can circle the whole set without hunting for a control.
 *
 * The cursor is held per position rather than per id: pins arrive and are removed
 * while the bar is open, and clamping an index survives that where a dangling id
 * would not.
 */
export function usePinnedCursor(messages: ChatMessage[], onJump: (messageId: Id) => void) {
  const [index, setIndex] = useState(0)

  // A pin removed from under the cursor must not leave it pointing past the end.
  const count = messages.length
  useEffect(() => {
    setIndex((current) => (count === 0 ? 0 : Math.min(current, count - 1)))
  }, [count])

  const current = count === 0 ? null : messages[Math.min(index, count - 1)] ?? null

  /** Go to the pin on show, then arm the bar with the one after it. */
  const step = useCallback(() => {
    if (!current) return
    onJump(current.id)
    setIndex((previous) => (count === 0 ? 0 : (previous + 1) % count))
  }, [current, count, onJump])

  return {
    current,
    /** 0-based position of the pin on show, for the stepper bars. */
    index: count === 0 ? 0 : Math.min(index, count - 1),
    count,
    step,
  }
}
