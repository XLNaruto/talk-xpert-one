import { useCallback, useState } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { useChatActions } from '../api/use-chat-actions'
import * as chatApi from '../api/chat-api'
import { canEditGroup, successorOf } from '../lib/member-roles'
import { resolveTalkUser } from '../lib/talk-directory'
import type { Chat } from '../types'

/** The header writes that take something away, and so ask first. */
export type ChatHeaderConfirmKind = 'disband' | 'leave' | 'remove'

/**
 * Holds the "do you mean it?" question for the header's destructive buttons.
 *
 * The header itself only draws buttons, so the pending question lives here — and
 * the dialog stays open on a failure, because each action resolves `false` and
 * the toast has already said why.
 *
 * The creator's leave is the one question that needs an ANSWER before it can be
 * asked properly: the group is handed on, and to whom is not obvious. So the
 * member list is read when the question opens rather than on every header, and
 * the heir is worked out with the server's own rule — longest-standing admin,
 * else longest-standing member. A read that fails, or a group the creator is the
 * last one out of, leaves `successorName` null and the copy hedges instead of
 * naming somebody wrongly.
 */
export function useChatHeaderActions(chat: Chat) {
  const chatId = chat.id
  const { leaveGroup, disbandGroup, deleteForMe, isPending } = useChatActions()
  const [confirmKind, setConfirmKind] = useState<ChatHeaderConfirmKind | null>(null)
  const [successorName, setSuccessorName] = useState<string | null>(null)
  // The person LEAVING is me, so I am the row the succession rule skips.
  const selfId = useAuthStore((s) => s.identity?.talkUserId ?? null)

  const ask = useCallback(
    (kind: ChatHeaderConfirmKind) => {
      setConfirmKind(kind)
      setSuccessorName(null)
      // Only the creator's leave hands the group on, so nobody else's question
      // costs a request.
      if (kind !== 'leave' || chat.type !== 'group' || !canEditGroup(chat.self.memberRole)) return
      void (async () => {
        try {
          const members = await chatApi.fetchMembers(chatId)
          const heir = successorOf(members, selfId)
          setSuccessorName(
            heir ? resolveTalkUser(heir.talkUserId, heir.name, heir.photo).name : null,
          )
        } catch {
          // The hedged sentence is a correct sentence — a failed read must not
          // stop the owner leaving.
        }
      })()
    },
    [chatId, chat.type, chat.self.memberRole, selfId],
  )

  const cancel = useCallback(() => setConfirmKind(null), [])

  const run = useCallback(async () => {
    if (confirmKind === null) return
    const ok =
      confirmKind === 'disband'
        ? await disbandGroup(chatId)
        : confirmKind === 'leave'
          ? await leaveGroup(chatId)
          : await deleteForMe([chatId])
    if (ok) setConfirmKind(null)
  }, [chatId, confirmKind, disbandGroup, leaveGroup, deleteForMe])

  return { confirmKind, successorName, ask, cancel, run, isPending }
}
