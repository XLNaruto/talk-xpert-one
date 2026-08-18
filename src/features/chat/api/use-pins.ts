import { useCallback, useEffect, useState } from 'react'
import { logger } from '@/lib/logger'
import type { Id } from '@/types/api'
import type { PinnedMessage } from '../types'
import * as chatApi from './chat-api'

/**
 * The pin bar: live, unexpired pins, newest first.
 *
 * Expiry is filtered at READ time rather than swept by a job, so this is re-read
 * when the thread opens and whenever a pin event lands — a cached list would keep
 * showing a pin that has since lapsed.
 */
export function usePins(chatId: Id | null) {
  const [pins, setPins] = useState<PinnedMessage[]>([])

  const refetch = useCallback(async () => {
    if (chatId == null) {
      setPins([])
      return
    }
    try {
      setPins(await chatApi.fetchPins(chatId))
    } catch (error) {
      // The pin bar is an addition to the thread, not a prerequisite for it.
      logger.warn('pin read failed', chatId, error)
      setPins([])
    }
  }, [chatId])

  useEffect(() => {
    void refetch()
  }, [refetch])

  return { pins, refetch }
}
