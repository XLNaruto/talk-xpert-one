import { useCallback, useEffect, useState } from 'react'
import { toastApiError } from '@/lib/api-toast'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import type { Id } from '@/types/api'
import type { MessageSearchHit } from '../types'
import * as chatApi from './chat-api'

/**
 * Full-text search over message text.
 *
 * Scoped to one chat when `chatId` is given, and otherwise across every chat I
 * am in. Either way it obeys my own history exactly as the thread does — a
 * message I hid does not come back through search.
 *
 * A hit is a LEAN message (id, chat, sender, body, time), not the full object, so
 * opening one means jumping to its thread rather than rendering it here.
 */
export function useMessageSearch(chatId?: Id) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<MessageSearchHit[]>([])
  const [total, setTotal] = useState(0)
  const [isSearching, setSearching] = useState(false)

  // Debounced, because this is a full-text query per keystroke otherwise.
  const debounced = useDebouncedValue(query.trim(), 350)

  const run = useCallback(
    async (q: string) => {
      // One character matches almost everything and costs a real query, so the
      // search waits for something worth searching for.
      if (q.length < 2) {
        setHits([])
        setTotal(0)
        return
      }
      setSearching(true)
      try {
        const page = await chatApi.searchMessages({ q, chatId })
        setHits(page.items)
        setTotal(page.total)
      } catch (error) {
        toastApiError(error, 'Could not search messages')
      } finally {
        setSearching(false)
      }
    },
    [chatId],
  )

  useEffect(() => {
    void run(debounced)
  }, [debounced, run])

  return { query, setQuery, hits, total, isSearching }
}
