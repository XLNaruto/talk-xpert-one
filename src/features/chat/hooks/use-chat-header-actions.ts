import { useCallback, useState } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { useChatActions } from '../api/use-chat-actions'
import * as chatApi from '../api/chat-api'
import { canEditGroup, successorOf } from '../lib/member-roles'
import { resolveTalkUser } from '../lib/talk-directory'
import type { Chat } from '../types'

/** The writes that take something away, and so ask first. */
export type ChatHeaderConfirmKind = 'disband' | 'leave' | 'remove'

/**
 * Holds the "do you mean it?" question for a chat's destructive actions.
 *
 * The buttons themselves only draw, so the pending question lives here — and the
 * dialog stays open on a failure, because each action resolves `false` and the
 * toast has already said why.
 *
 * The chat is named when the question is ASKED rather than when the hook is
 * mounted, because the sidebar asks it about whichever row was right-clicked
 * while the header always asks about the open thread. `useChatHeaderActions`
 * below is that second case, bound.
 *
 * The creator's leave is the one question that needs an ANSWER before it can be
 * asked properly: the group is handed on, and to whom is not obvious. So the
 * member list is read when the question opens rather than on every header, and
 * the heir is worked out with the server's own rule — longest-standing admin,
 * else longest-standing member. A read that fails, or a group the creator is the
 * last one out of, leaves `successorName` null and the copy hedges instead of
 * naming somebody wrongly.
 */
export function useChatConfirmActions() {
  const { leaveGroup, disbandGroup, deleteForMe, isPending } = useChatActions()
  const [asked, setAsked] = useState<{ kind: ChatHeaderConfirmKind; chat: Chat } | null>(
    null,
  )
  const [successorName, setSuccessorName] = useState<string | null>(null)
  // The person LEAVING is me, so I am the row the succession rule skips.
  const selfId = useAuthStore((s) => s.identity?.talkUserId ?? null)

  const ask = useCallback(
    (kind: ChatHeaderConfirmKind, chat: Chat) => {
      setAsked({ kind, chat })
      setSuccessorName(null)
      // Only the creator's leave hands the group on, so nobody else's question
      // costs a request.
      if (kind !== 'leave' || chat.type !== 'group' || !canEditGroup(chat.self.memberRole)) return
      void (async () => {
        try {
          const members = await chatApi.fetchMembers(chat.id)
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
    [selfId],
  )

  const cancel = useCallback(() => setAsked(null), [])

  const run = useCallback(async () => {
    if (asked === null) return
    const { kind, chat } = asked
    const ok =
      kind === 'disband'
        ? await disbandGroup(chat.id)
        : kind === 'leave'
          ? await leaveGroup(chat.id)
          : await deleteForMe([chat.id])
    if (ok) setAsked(null)
  }, [asked, disbandGroup, leaveGroup, deleteForMe])

  return {
    confirmKind: asked?.kind ?? null,
    /** The chat the open question is about — the dialog's copy names it. */
    confirmChat: asked?.chat ?? null,
    successorName,
    ask,
    cancel,
    run,
    isPending,
  }
}

/** The header's version: every question is about the thread already open. */
export function useChatHeaderActions(chat: Chat) {
  const confirm = useChatConfirmActions()
  const { ask: askAbout } = confirm
  const ask = useCallback(
    (kind: ChatHeaderConfirmKind) => askAbout(kind, chat),
    [askAbout, chat],
  )
  return { ...confirm, ask }
}
