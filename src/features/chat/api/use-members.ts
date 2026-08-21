import { useCallback, useEffect, useState } from 'react'
import { toastApiError, toastSuccess } from '@/lib/api-toast'
import { useChatListStore } from '@/stores/chat-list-store'
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
 * `.blocked` / `.role_changed`, which the stream turns into a bump on
 * `memberRevision` — without it an open sheet would sit stale while another
 * admin rearranged the group. My own change does not bump: the write below
 * already re-read.
 *
 * MY OWN change also moves the header's member count and, on a removal, drops
 * the row here and now — the count is the chat row's, so the re-read that makes
 * it authoritative is a second request and the sheet must not sit on stale
 * numbers while it is in flight. The stream skips the same patch for my own
 * actor, so the change is applied exactly once.
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

  /** Owner or admin. Ids outside this account are dropped silently by the server. */
  const addMembers = useCallback(
    async (talkUserIds: Id[]): Promise<boolean> => {
      if (chatId == null || talkUserIds.length === 0) return false
      try {
        await chatApi.addMembers(chatId, talkUserIds)
        useChatListStore.getState().applyMemberDelta(chatId, talkUserIds.length)
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
        // Drop the row straight away rather than waiting for the re-read: the
        // person is gone the moment the write returns.
        setMembers((held) => held.filter((member) => member.talkUserId !== talkUserId))
        useChatListStore.getState().applyMemberDelta(chatId, -1)
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
   * The group's block: the member stays and keeps reading, and loses posting.
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

  /**
   * Promote to admin, or demote back to a plain member.
   *
   * Re-read rather than patched, like every other write here: the server owns
   * roles, and the succession rules mean a role write is not always the only row
   * that moved. The write is IDEMPOTENT server-side, so a second tap is not
   * guarded against — it answers 200 and announces nothing.
   */
  const setMemberRole = useCallback(
    async (talkUserId: Id, memberRole: 'admin' | 'member'): Promise<boolean> => {
      if (chatId == null) return false
      try {
        await chatApi.setMemberRole(chatId, talkUserId, memberRole)
        await refetch()
        toastSuccess(memberRole === 'admin' ? 'Now an admin' : 'No longer an admin')
        return true
      } catch (error) {
        toastApiError(error, 'That role did not change')
        return false
      }
    },
    [chatId, refetch],
  )

  return {
    members,
    isLoading,
    refetch,
    addMembers,
    removeMember,
    setMemberBlocked,
    setMemberRole,
  }
}
