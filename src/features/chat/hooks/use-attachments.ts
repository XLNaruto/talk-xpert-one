import { useCallback } from 'react'
import { toastProblem } from '@/lib/api-toast'
import { useChatStore } from '@/stores/chat-store'
import { keyOf, type Id } from '@/types/api'
import { intakeAttachments } from '../lib/attachment-intake'

/** One shared empty array, so a chat with no attachments never re-renders. */
const NONE: File[] = []

/**
 * The files waiting to be sent in one chat.
 *
 * The state lives in `chat-store` rather than in the composer, because the drop
 * target is the whole thread pane: `chat-area.tsx` calls `addFiles`, and
 * `message-input.tsx` draws what landed.
 */
export function useAttachments(chatId: Id | null) {
  const files = useChatStore((s) =>
    chatId == null ? NONE : s.attachments[keyOf(chatId)] ?? NONE,
  )
  const setAttachments = useChatStore((s) => s.setAttachments)
  const clearAttachments = useChatStore((s) => s.clearAttachments)

  const addFiles = useCallback(
    (picked: FileList | File[] | null) => {
      if (chatId == null) return 0
      const { accepted, rejected } = intakeAttachments(picked, files.length)
      if (accepted.length > 0) setAttachments(chatId, [...files, ...accepted])
      // One toast for the batch: fifteen rejections would be fifteen toasts.
      // Only the first few are named, and the count of the rest is still stated.
      if (rejected.length > 0) {
        const shown = rejected.slice(0, 3).join('. ')
        const hidden = rejected.length - 3
        toastProblem(hidden > 0 ? `${shown}. And ${hidden} more.` : `${shown}.`)
      }
      return accepted.length
    },
    [chatId, files, setAttachments],
  )

  const removeFile = useCallback(
    (index: number) => {
      if (chatId == null) return
      setAttachments(chatId, files.filter((_, i) => i !== index))
    },
    [chatId, files, setAttachments],
  )

  const clearFiles = useCallback(() => {
    if (chatId != null) clearAttachments(chatId)
  }, [chatId, clearAttachments])

  return { files, addFiles, removeFile, clearFiles }
}
