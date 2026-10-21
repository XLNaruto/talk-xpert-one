import { useCallback, useEffect, useState } from 'react'
import type { Id } from '@/types/api'
import { isPollClosed, nextPollChoice } from '../lib/polls'
import type { ChatMessage } from '../types'

/** How often an open, timed poll re-reads the clock — enough for "Ends in 3 min". */
const POLL_CLOCK_MS = 15_000

/**
 * One poll bubble's logic: the clock that closes it at `ends_at`, and the vote
 * in flight.
 *
 * The clock is why this is a hook and not a pure derivation: a timed poll has to
 * stop taking votes the moment `ends_at` passes, without waiting the half-minute
 * the server may take to announce it — a vote from then on is a 409 anyway. The
 * timer only runs while there is a deadline still ahead.
 */
export function usePollCard(
  message: ChatMessage,
  onVote: (message: ChatMessage, optionIds: Id[]) => Promise<boolean>,
) {
  const poll = message.poll
  const [now, setNow] = useState(() => Date.now())
  /** The option a tap is waiting on, so that row alone shows it is working. */
  const [pendingOptionId, setPendingOptionId] = useState<Id | null>(null)

  const endsAt = poll?.endsAt ? new Date(poll.endsAt).getTime() : null
  const isOpenWithTimer = poll !== null && !poll.isClosed && endsAt !== null

  useEffect(() => {
    if (!isOpenWithTimer || endsAt === null) return
    // Land exactly on the deadline as well as ticking towards it, so the switch
    // to closed is not up to fifteen seconds late.
    const tick = setInterval(() => setNow(Date.now()), POLL_CLOCK_MS)
    const atEnd = setTimeout(() => setNow(Date.now()), Math.max(0, endsAt - Date.now()) + 50)
    return () => {
      clearInterval(tick)
      clearTimeout(atEnd)
    }
  }, [isOpenWithTimer, endsAt])

  const isClosed = poll ? isPollClosed(poll, now) : true

  const tap = useCallback(
    async (optionId: Id) => {
      if (!poll || isClosed || pendingOptionId !== null) return
      setPendingOptionId(optionId)
      await onVote(message, nextPollChoice(poll, optionId))
      setPendingOptionId(null)
    },
    [poll, isClosed, pendingOptionId, onVote, message],
  )

  return { now, isClosed, pendingOptionId, tap }
}
