import { useEffect, useState } from 'react'

/**
 * Is this window actually being LOOKED AT — visible, and holding the focus.
 *
 * A read receipt is a claim about a human's eyes, so a thread rendered into a
 * background tab or an unfocused window has not been read: the rows are mounted,
 * the virtualiser reports a healthy visible range, and nothing about the DOM can
 * tell the difference. Two windows side by side is the case that makes it
 * obvious — without this, the copy nobody is looking at marks every arrival read
 * and the sender sees two ticks against a message that was never seen.
 *
 * Focus as well as visibility, because an unfocused-but-visible window is the
 * same claim: the reader is in the other one.
 */
export function isPageActive(): boolean {
  if (typeof document === 'undefined') return true
  return document.visibilityState === 'visible' && document.hasFocus()
}

/**
 * Subscribe to that answer changing. Returns the unsubscribe.
 *
 * Exported alongside the hook because the read path is imperative — it needs to
 * replay the receipt the moment the window comes back, not on the next render.
 */
export function subscribePageActive(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange)
  window.addEventListener('focus', onChange)
  window.addEventListener('blur', onChange)
  return () => {
    document.removeEventListener('visibilitychange', onChange)
    window.removeEventListener('focus', onChange)
    window.removeEventListener('blur', onChange)
  }
}

/** The same answer as state, for anything that renders off it. */
export function usePageActive(): boolean {
  const [active, setActive] = useState(isPageActive)

  useEffect(() => subscribePageActive(() => setActive(isPageActive())), [])

  return active
}
