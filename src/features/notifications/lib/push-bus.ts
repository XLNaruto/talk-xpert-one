import type { TalkPushEvent } from '../types'

/**
 * The seam between a push and whoever handles the event inside it.
 *
 * A push arrives in three different places — `onMessage` in a focused tab, a
 * `postMessage` from the service worker in a hidden one, and a tapped banner —
 * and all three carry the SAME object the socket publishes. So none of them
 * needs a handler of its own: they publish here, and
 * `features/chat/hooks/use-message-stream.ts` feeds them to the handlers it
 * already binds to the socket.
 *
 * A plain module-level emitter rather than a store: nothing renders from it, and
 * a Zustand state that is written and immediately read back is a queue wearing a
 * store's clothes.
 */

type Listener = (event: TalkPushEvent) => void

const eventListeners = new Set<Listener>()
const clickListeners = new Set<Listener>()

/** A push arrived — apply it to the caches, wherever it came from. */
export function publishPushEvent(event: TalkPushEvent): void {
  for (const listener of eventListeners) listener(event)
}

export function onPushEvent(listener: Listener): () => void {
  eventListeners.add(listener)
  return () => eventListeners.delete(listener)
}

/** A banner was TAPPED — open what it named. Separate, because it navigates. */
export function publishPushClick(event: TalkPushEvent): void {
  for (const listener of clickListeners) listener(event)
}

export function onPushClick(listener: Listener): () => void {
  clickListeners.add(listener)
  return () => clickListeners.delete(listener)
}
