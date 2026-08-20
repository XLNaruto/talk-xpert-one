import { useCallback, useEffect, useState } from 'react'
import { toastApiError, toastSuccess } from '@/lib/api-toast'
import { useChatStore } from '@/stores/chat-store'
import { keyOf, type Id } from '@/types/api'
import type { ChatMember } from '../types'
import * as chatApi from './chat-api'

/**
 * A group's members. Any member may read this — knowing who is in a conversation
 * is not privileged.
 *
 * The list is re-read rather than patched after a write, because the server owns
 * roles and block flags and a local guess at either would drift.
 *
 * SOMEBODY ELSE's change arrives as `talk.member.added` / `.left` / `.removed` /
 * `.blocked`, which the stream turns into a bump on `memberRevision` — without
 * it an open sheet would sit stale while another owner rearranged the group. My
 * own change does not bump: the write below already re-read.
 */
export function useMembers(chatId: Id | null, enabled = true) {
  const [members, setMembers] = useState<ChatMember[]>([])
  const [isLoading, setLoading] = useState(false)
  const revision = useChatStore((s) =>
    chatId == null ? 0 : (s.memberRevision[keyOf(chatId)] ?? 0),
  )

  const refetch = useCallback(async () => {
    if (chatId == null) return
    setLoading(true)
    try {
      setMembers(await chatApi.fetchMembers(chatId))
    } catch (error) {
      toastApiError(error, 'Could not load the member list')
    } finally {
      setLoading(false)
    }
  }, [chatId])

  useEffect(() => {
    if (!enabled || chatId == null) return
    void refetch()
  }, [enabled, chatId, refetch, revision])

  /** Owner only. Ids outside this account are dropped silently by the server. */
  const addMembers = useCallback(
    async (talkUserIds: Id[]): Promise<boolean> => {
      if (chatId == null || talkUserIds.length === 0) return false
      try {
        await chatApi.addMembers(chatId, talkUserIds)
        await refetch()
        toastSuccess(
          talkUserIds.length === 1 ? 'Added to the group' : `${talkUserIds.length} people added`,
        )
        return true
      } catch (error) {
        toastApiError(error, 'Those people were not added')
        return false
      }
    },
    [chatId, refetch],
  )

  const removeMember = useCallback(
    async (talkUserId: Id): Promise<boolean> => {
      if (chatId == null) return false
      try {
        await chatApi.removeMember(chatId, talkUserId)
        await refetch()
        toastSuccess('Removed from the group')
        return true
      } catch (error) {
        toastApiError(error, 'That person was not removed')
        return false
      }
    },
    [chatId, refetch],
  )

  /**
   * The owner's block: the member stays and keeps reading, and loses posting.
   * Deliberately not a removal — their app still shows the conversation.
   */
  const setMemberBlocked = useCallback(
    async (talkUserId: Id, blocked: boolean): Promise<boolean> => {
      if (chatId == null) return false
      try {
        await chatApi.setMemberBlocked(chatId, talkUserId, blocked)
        await refetch()
        toastSuccess(blocked ? 'Blocked from posting' : 'Allowed to post again')
        return true
      } catch (error) {
        toastApiError(error, 'That change did not save')
        return false
      }
    },
    [chatId, refetch],
  )

  return { members, isLoading, refetch, addMembers, removeMember, setMemberBlocked }
}
