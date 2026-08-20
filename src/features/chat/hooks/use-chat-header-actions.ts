import { useCallback, useState } from 'react'
import type { Id } from '@/types/api'
import { useChatActions } from '../api/use-chat-actions'

/** The header writes that take something away, and so ask first. */
export type ChatHeaderConfirmKind = 'disband' | 'leave' | 'remove'

/**
 * Holds the "do you mean it?" question for the header's destructive buttons.
 *
 * The header itself only draws buttons, so the pending question lives here — and
 * the dialog stays open on a failure, because each action resolves `false` and
 * the toast has already said why.
 */
export function useChatHeaderActions(chatId: Id) {
  const { leaveGroup, disbandGroup, deleteForMe, isPending } = useChatActions()
  const [confirmKind, setConfirmKind] = useState<ChatHeaderConfirmKind | null>(null)

  const ask = useCallback((kind: ChatHeaderConfirmKind) => setConfirmKind(kind), [])
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

  return { confirmKind, ask, cancel, run, isPending }
}
