import { useEffect, useState } from 'react'

/**
 * How long an interaction keeps an unfocused window counting as looked-at.
 *
 * Long enough to cover reading between scrolls, short enough that a window left
 * alone behind another one stops claiming its arrivals were seen.
 */
const INTERACTION_GRACE_MS = 30_000

/** When this window was last scrolled, clicked, typed in or touched. */
let lastInteractionAt = 0

/**
 * Is this window actually being LOOKED AT?
 *
 * A read receipt is a claim about a human's eyes, so a thread rendered into a
 * background tab has not been read: the rows are mounted, the virtualiser
 * reports a healthy visible range, and nothing about the DOM can tell the
 * difference. Without this, the copy nobody is looking at marks every arrival
 * read and the sender sees two ticks against a message that was never seen.
 *
 * Visible AND (focused OR just interacted with). Focus alone was too strict:
 * the WHEEL scrolls the window under the pointer without focusing it, so
 * somebody reading a conversation side by side with another window — scrolling
 * it, watching it — was reading nothing as far as this was concerned, and their
 * unread count only ever grew. An event only reaches the window it happened
 * over, so an interaction here is evidence about THIS window and no other.
 */
export function isPageActive(): boolean {
  if (typeof document === 'undefined') return true
  if (document.visibilityState !== 'visible') return false
  if (document.hasFocus()) return true
  return Date.now() - lastInteractionAt < INTERACTION_GRACE_MS
}

/**
 * Subscribe to that answer changing. Returns the unsubscribe.
 *
 * Exported alongside the hook because the read path is imperative — it needs to
 * replay the receipt the moment the window comes back, not on the next render.
 */
export function subscribePageActive(onChange: () => void): () => void {
  /**
   * An interaction can turn the answer from no to yes, and the receipt owed
   * from before it is due the moment it does. Only the TRANSITION notifies —
   * a wheel gesture is a hundred events and the subscriber re-reads the visible
   * range each time it is called.
   */
  const onInteract = () => {
    const wasActive = isPageActive()
    lastInteractionAt = Date.now()
    if (!wasActive) onChange()
  }

  document.addEventListener('visibilitychange', onChange)
  window.addEventListener('focus', onChange)
  window.addEventListener('blur', onChange)
  for (const event of INTERACTION_EVENTS) {
    window.addEventListener(event, onInteract, { passive: true, capture: true })
  }
  return () => {
    document.removeEventListener('visibilitychange', onChange)
    window.removeEventListener('focus', onChange)
    window.removeEventListener('blur', onChange)
    for (const event of INTERACTION_EVENTS) {
      window.removeEventListener(event, onInteract, { capture: true })
    }
  }
}

/** What counts as the reader touching this window. */
const INTERACTION_EVENTS = ['wheel', 'pointerdown', 'keydown', 'touchstart'] as const

/** The same answer as state, for anything that renders off it. */
export function usePageActive(): boolean {
  const [active, setActive] = useState(isPageActive)

  useEffect(() => subscribePageActive(() => setActive(isPageActive())), [])

  return active
}
