import { useCallback, useEffect, useState } from 'react'
import { toApiError } from '@/lib/api-error'
import { toastApiError } from '@/lib/api-toast'
import { useMessageCacheStore } from '@/stores/message-cache-store'
import type { Id } from '@/types/api'
import { resyncPreview } from '../hooks/use-message-stream'
import type { CreatePollInput, PollVotes } from '../types'
import * as chatApi from './chat-api'

/**
 * Post a poll.
 *
 * Not optimistic, unlike a text send: the bubble IS the poll, and its options
 * come back with ids the client cannot invent — a placeholder would have nothing
 * to vote on. So the form waits and stays open on a failure, which keeps every
 * option the person typed (rule 15's promise, kept a different way). The
 * `client_message_id` still makes a retried create answer the same message.
 */
export function useCreatePoll() {
  const upsertOne = useMessageCacheStore((s) => s.upsertOne)
  const [isPending, setPending] = useState(false)

  const create = useCallback(
    async (input: CreatePollInput): Promise<boolean> => {
      setPending(true)
      try {
        const message = await chatApi.createPoll(input)
        // The echo usually beats this answer; both merge by id.
        upsertOne(input.chatId, message)
        resyncPreview(input.chatId)
        return true
      } catch (error) {
        toastApiError(error, 'That poll was not posted')
        return false
      } finally {
        setPending(false)
      }
    },
    [upsertOne],
  )

  return { create, isPending }
}

/**
 * "View votes" — everyone who voted, one tab at a time. `optionId` null is All.
 *
 * `options` and `totalVoters` come back the same on every tab, for the badges,
 * so only `items` changes as the tabs are walked.
 */
export function usePollVotes(chatId: Id, messageId: Id, optionId: Id | null) {
  const [votes, setVotes] = useState<PollVotes | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    chatApi
      .fetchPollVotes(chatId, messageId, optionId ?? undefined)
      .then((answer) => {
        if (!cancelled) setVotes(answer)
      })
      .catch((cause) => {
        if (cancelled) return
        setError(
          toApiError(cause).status === 404
            ? 'This poll is no longer available.'
            : 'Votes could not be loaded. Close this and try again.',
        )
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [chatId, messageId, optionId])

  return { votes, error, isLoading }
}
