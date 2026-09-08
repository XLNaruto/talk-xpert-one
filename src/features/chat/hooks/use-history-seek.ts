import { useCallback, useRef, useState } from 'react'
import { cachedMessages } from '@/stores/message-cache-store'
import type { Id } from '@/types/api'
import { THREAD_SEARCH_MAX_HISTORY_PAGES } from '../constants'

interface HistorySeekOptions {
  chatId: Id | null
  /** Pull one more page of older history. Resolves once the page has landed. */
  loadEarlier: () => Promise<void> | void
  /** False once the thread has reached its beginning — the walk must stop there. */
  hasEarlier: boolean
}

/**
 * How a walk ended — and why "not found" is not one answer but two.
 *
 * `capped` is the walk giving up with history still to go: the message really is
 * too far back to reach from here, and saying so is honest. `gone` is the walk
 * reaching the START of my history without finding it, which means the message
 * is not in my copy of this conversation AT ALL — I deleted it for myself, or it
 * was written before I joined the group, or it arrived while I had the sender
 * blocked. Telling that reader it is "too far back" sends them scrolling for
 * something that is not there.
 *
 * `busy` is a second walk refused while one is in flight. Nothing is said for
 * it: the first walk is still going to land.
 */
export type SeekOutcome = 'found' | 'capped' | 'gone' | 'busy'

/**
 * Walk history back until a given message is in the cache.
 *
 * The list can only scroll to a row it is drawing, and the thread only holds the
 * pages it has read. So anything that points AT a message from outside the loaded
 * window — a search hit, a pin, a reply quote — has to pull history back to it
 * first. Messages page by id from the newest end, so that means fetching every
 * page in between; the walk is bounded by `THREAD_SEARCH_MAX_HISTORY_PAGES` or a
 * pin from last year would quietly drag in the whole conversation.
 */
export function useHistorySeek({ chatId, loadEarlier, hasEarlier }: HistorySeekOptions) {
  /** True while history is being walked back to reach an off-screen message. */
  const [isSeeking, setSeeking] = useState(false)

  // The walk reads the cache and `hasEarlier` as they change mid-loop, so both
  // are mirrored into refs — the loop cannot close over a stale render's value.
  const hasEarlierRef = useRef(hasEarlier)
  hasEarlierRef.current = hasEarlier
  const loadEarlierRef = useRef(loadEarlier)
  loadEarlierRef.current = loadEarlier
  /** Guards against a second walk starting while one is in flight. */
  const seeking = useRef(false)

  const ensureLoaded = useCallback(
    async (messageId: Id): Promise<SeekOutcome> => {
      if (chatId == null) return 'gone'
      const isLoaded = () => cachedMessages(chatId).some((message) => message.id === messageId)
      if (isLoaded()) return 'found'
      if (seeking.current) return 'busy'

      seeking.current = true
      setSeeking(true)
      try {
        for (let page = 0; page < THREAD_SEARCH_MAX_HISTORY_PAGES; page += 1) {
          // The beginning of history, so there is nowhere left to look: the
          // message is not in my copy of this chat rather than merely far up it.
          if (!hasEarlierRef.current) return isLoaded() ? 'found' : 'gone'
          await loadEarlierRef.current()
          if (isLoaded()) return 'found'
        }
        // Fell out of the loop with pages still unread — the cap stopped us, not
        // the start of the conversation.
        return isLoaded() ? 'found' : hasEarlierRef.current ? 'capped' : 'gone'
      } finally {
        seeking.current = false
        setSeeking(false)
      }
    },
    [chatId],
  )

  /**
   * Is a walk in flight RIGHT NOW — read imperatively, not from a render.
   *
   * `isSeeking` is state and is a render behind, which is no good to a click
   * handler deciding whether it may start a second walk. A second one cannot
   * overtake the first anyway (`ensureLoaded` refuses it), so the caller needs to
   * know before it has committed to anything.
   */
  const isSeekingNow = useCallback(() => seeking.current, [])

  return { ensureLoaded, isSeeking, isSeekingNow }
}
