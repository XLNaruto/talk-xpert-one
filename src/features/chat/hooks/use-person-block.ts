import { useCallback, useState } from 'react'
import type { Id } from '@/types/api'
import { useChatActions } from '../api/use-chat-actions'

/** The block or unblock waiting on a yes — to whom, and which way. */
export interface PersonBlockRequest {
  talkUserId: Id
  name: string
  /** True to block, false to unblock. */
  blocked: boolean
}

/**
 * Holds the "do you mean it?" question for MY private, account-wide block.
 *
 * Blocking asks because it is silent and durable: the other person is never
 * told, and it survives the conversation being deleted — so a stray tap on the
 * header's icon would cut somebody off with nothing on screen to say it
 * happened. Unblocking asks for the mirror reason: it re-opens a channel the
 * user deliberately closed.
 *
 * The write itself stays in `useChatActions` — this only decides WHEN it runs.
 * A failure leaves the question up beside its toast rather than closing as
 * though it had worked.
 */
export function usePersonBlock() {
  const { setPersonBlocked } = useChatActions()
  const [request, setRequest] = useState<PersonBlockRequest | null>(null)
  const [isPending, setPending] = useState(false)

  const ask = useCallback(
    (talkUserId: Id, name: string, blocked: boolean) =>
      setRequest({ talkUserId, name, blocked }),
    [],
  )

  const cancel = useCallback(() => {
    if (!isPending) setRequest(null)
  }, [isPending])

  const run = useCallback(async () => {
    if (!request || isPending) return
    setPending(true)
    try {
      const ok = await setPersonBlocked(request.talkUserId, request.blocked)
      if (ok) setRequest(null)
    } finally {
      setPending(false)
    }
  }, [request, isPending, setPersonBlocked])

  return { request, isPending, ask, cancel, run }
}
