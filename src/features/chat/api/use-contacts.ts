import { useCallback, useEffect, useRef, useState } from 'react'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { toastApiError } from '@/lib/api-toast'
import type { Id } from '@/types/api'
import { CONTACT_PAGE_SIZE } from '../constants'
import type { Contact } from '../types'
import * as chatApi from './chat-api'

interface UseContactsOptions {
  /** Matched server-side against the name and the Talk login. */
  search?: string
  companyId?: Id
  /** Employees only — a back-office user has no department to be in. */
  departmentId?: Id
  /** Off while the sheet holding the picker is closed. */
  enabled?: boolean
}

/**
 * The directory: everyone I may start a chat with, searched server-side.
 *
 * Searching HAS to be a request rather than a filter over what we hold — the
 * list pages, so filtering the loaded page would search thirty names instead of
 * the organisation. It is debounced for the same reason the message search is.
 *
 * Two loading flags, because they mean different things on screen: `isLoading`
 * replaces the list (a new search), `isLoadingMore` appends to it (paging), and
 * a "load more" spinner that blanked the rows above it would lose the reader's
 * place. Responses are sequence-checked so a slow first keystroke cannot land
 * after a fast third one and repaint stale rows.
 */
export function useContacts({
  search = '',
  companyId,
  departmentId,
  enabled = true,
}: UseContactsOptions = {}) {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [total, setTotal] = useState(0)
  const [isLoading, setLoading] = useState(false)
  const [isLoadingMore, setLoadingMore] = useState(false)

  // One counter for both the fresh read and the paging read: whichever request
  // was issued last is the only one allowed to write.
  const requestId = useRef(0)
  const debounced = useDebouncedValue(search.trim(), 300)

  const load = useCallback(async () => {
    if (!enabled) return
    const ticket = ++requestId.current
    setLoading(true)
    try {
      const page = await chatApi.fetchContacts({
        search: debounced,
        companyId,
        departmentId,
        limit: CONTACT_PAGE_SIZE,
        offset: 0,
      })
      if (ticket !== requestId.current) return
      setContacts(page.items)
      setTotal(page.total)
    } catch (error) {
      if (ticket !== requestId.current) return
      toastApiError(error, 'Could not load your contacts')
    } finally {
      if (ticket === requestId.current) setLoading(false)
    }
  }, [companyId, debounced, departmentId, enabled])

  useEffect(() => {
    void load()
  }, [load])

  /** The next page, appended. A no-op while a read is already in flight. */
  const loadMore = useCallback(async () => {
    if (!enabled || isLoading || isLoadingMore) return
    const offset = contacts.length
    if (offset >= total) return
    const ticket = ++requestId.current
    setLoadingMore(true)
    try {
      const page = await chatApi.fetchContacts({
        search: debounced,
        companyId,
        departmentId,
        limit: CONTACT_PAGE_SIZE,
        offset,
      })
      if (ticket !== requestId.current) return
      // Merge by id: reach is read live, so a page boundary can shift between
      // requests and repeat somebody rather than skipping them.
      setContacts((held) => {
        const seen = new Set(held.map((contact) => contact.talkUserId))
        return [...held, ...page.items.filter((contact) => !seen.has(contact.talkUserId))]
      })
      setTotal(page.total)
    } catch (error) {
      if (ticket !== requestId.current) return
      toastApiError(error, 'Could not load more contacts')
    } finally {
      if (ticket === requestId.current) setLoadingMore(false)
    }
  }, [companyId, contacts.length, debounced, departmentId, enabled, isLoading, isLoadingMore, total])

  return {
    contacts,
    total,
    isLoading,
    isLoadingMore,
    hasMore: contacts.length < total,
    /** True while the debounce is still holding the newest keystroke. */
    isSearching: search.trim() !== debounced,
    loadMore,
    refetch: load,
  }
}
