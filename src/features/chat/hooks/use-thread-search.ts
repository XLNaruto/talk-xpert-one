import { useCallback, useEffect, useState } from 'react'
import { toastApiError, toastProblem } from '@/lib/api-toast'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import type { Id } from '@/types/api'
import * as chatApi from '../api/chat-api'
import { THREAD_SEARCH_HIT_CAP, THREAD_SEARCH_PAGE_SIZE } from '../constants'
import { seekFailureText } from '../lib/chat-labels'
import type { MessageSearchHit } from '../types'
import { useHistorySeek } from './use-history-seek'

interface UseThreadSearchOptions {
  chatId: Id | null
  /** Pull one more page of older history. Resolves once the page has landed. */
  loadEarlier: () => Promise<void> | void
  /** False once the thread has reached its beginning — the walk must stop there. */
  hasEarlier: boolean
}

/**
 * Find-in-conversation: the browser's Ctrl+F, over one thread.
 *
 * Two halves that have to agree. The SERVER knows every match, because full-text
 * search runs over the whole thread; the CLIENT only holds the pages it has
 * scrolled through. So a hit is found remotely and then walked to locally —
 * `loadEarlier` is pumped until the target id is in the cache, and only then does
 * the list scroll to it.
 *
 * Hits are ordered oldest → newest so "12 / 44" counts the way the thread reads,
 * and navigation starts at the newest match, which is the one nearest what is
 * already on screen.
 */
export function useThreadSearch({ chatId, loadEarlier, hasEarlier }: UseThreadSearchOptions) {
  const [isOpen, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<MessageSearchHit[]>([])
  const [activeIndex, setActiveIndex] = useState(-1)
  const [isSearching, setSearching] = useState(false)

  const debounced = useDebouncedValue(query.trim(), 350)

  // Reaching a hit that is not loaded yet is the same walk a pin or a reply
  // quote makes, so it lives in one place.
  const { ensureLoaded, isSeeking } = useHistorySeek({ chatId, loadEarlier, hasEarlier })

  const reset = useCallback(() => {
    setQuery('')
    setHits([])
    setActiveIndex(-1)
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    reset()
  }, [reset])

  const open = useCallback(() => setOpen(true), [])

  // A find bar belongs to the thread it was opened over.
  useEffect(() => {
    setOpen(false)
    reset()
  }, [chatId, reset])

  /**
   * Ctrl+F — ⌘F on a Mac — toggles the bar, and SUPPRESSES the browser's own.
   *
   * The native find bar would only ever match the pages currently in the DOM,
   * which is a fraction of the thread and silently so. Ours asks the server, so
   * taking the shortcut is the honest answer rather than a hijack.
   */
  useEffect(() => {
    if (chatId == null) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'f' && event.key !== 'F') return
      if (event.altKey || !(event.ctrlKey || event.metaKey)) return
      event.preventDefault()
      if (isOpen) close()
      else open()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [chatId, isOpen, open, close])

  /**
   * Every match, not just the first page.
   *
   * The bar offers prev/next over a numbered set, so a set that stops at 50 while
   * claiming 200 matches would strand the rest. Paging is bounded by
   * `THREAD_SEARCH_HIT_CAP` and the shortfall is said out loud rather than hidden.
   */
  useEffect(() => {
    if (!isOpen || chatId == null) return
    if (debounced.length < 2) {
      setHits([])
      setActiveIndex(-1)
      return
    }

    let cancelled = false
    const collect = async () => {
      setSearching(true)
      try {
        const collected: MessageSearchHit[] = []
        let total = 0
        for (let offset = 0; offset < THREAD_SEARCH_HIT_CAP; offset += THREAD_SEARCH_PAGE_SIZE) {
          const page = await chatApi.searchMessages({
            q: debounced,
            chatId,
            limit: THREAD_SEARCH_PAGE_SIZE,
            offset,
          })
          if (cancelled) return
          total = page.total
          collected.push(...page.items)
          if (page.items.length < THREAD_SEARCH_PAGE_SIZE || collected.length >= total) break
        }

        // Ascending by id IS ascending by time — ids are issued in send order —
        // and it is the order the thread is drawn in.
        const ordered = collected
          .filter((hit, index, all) => all.findIndex((other) => other.id === hit.id) === index)
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

        setHits(ordered)
        // Start at the newest match: it is the one closest to what is on screen,
        // so it usually needs no history walk at all.
        setActiveIndex(ordered.length > 0 ? ordered.length - 1 : -1)
        if (total > ordered.length) {
          toastProblem(
            `Showing the newest ${ordered.length} of ${total} matches. Try a longer word.`,
          )
        }
      } catch (error) {
        if (!cancelled) toastApiError(error, 'Could not search this conversation')
      } finally {
        if (!cancelled) setSearching(false)
      }
    }

    void collect()
    return () => {
      cancelled = true
    }
  }, [isOpen, chatId, debounced])

  const goTo = useCallback(
    async (index: number) => {
      if (index < 0 || index >= hits.length) return
      setActiveIndex(index)
      const outcome = await ensureLoaded(hits[index].id)
      // A hit the SERVER found but my thread cannot reach tells the two failures
      // apart the same way a reply quote does — and here `gone` is the stranger
      // of the pair, since search obeys my history too: the message went between
      // the search and the step to it.
      if (outcome !== 'found' && outcome !== 'busy') {
        toastProblem(seekFailureText(outcome))
      }
    },
    [hits, ensureLoaded],
  )

  /** Up: one match older. Down: one match newer. Both wrap, as a find bar does. */
  const goPrevious = useCallback(() => {
    if (hits.length === 0) return
    void goTo(activeIndex <= 0 ? hits.length - 1 : activeIndex - 1)
  }, [hits.length, activeIndex, goTo])

  const goNext = useCallback(() => {
    if (hits.length === 0) return
    void goTo(activeIndex >= hits.length - 1 ? 0 : activeIndex + 1)
  }, [hits.length, activeIndex, goTo])

  // Opening on the newest hit still has to load it, exactly like stepping does.
  const activeHit = activeIndex >= 0 ? hits[activeIndex] : undefined
  const activeHitId = activeHit?.id
  useEffect(() => {
    if (activeHitId === undefined) return
    void ensureLoaded(activeHitId)
  }, [activeHitId, ensureLoaded])

  return {
    isOpen,
    open,
    close,
    query,
    setQuery,
    hits,
    /** 1-based for display; 0 when there is nothing to point at. */
    position: activeIndex >= 0 ? activeIndex + 1 : 0,
    total: hits.length,
    /** The message the list should scroll to and band. */
    activeMessageId: activeHitId ?? null,
    /** Every match in the loaded thread, for the softer background tint. */
    hitMessageIds: hits.map((hit) => hit.id),
    isSearching,
    isSeeking,
    goPrevious,
    goNext,
  }
}
