import { useCallback, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { toastProblem } from '@/lib/api-toast'
import { intakeAttachments } from '../lib/attachment-intake'
import { messageInputSchema } from '../schemas'
import { useComposerLinkPreview } from './use-composer-link-preview'
import type { LinkPreview } from '../types'

/**
 * The broadcast composer: text, files and the link card — the same rules as the
 * chat composer, minus the parts a broadcast does not have (no reply, no edit,
 * no typing, no poll).
 *
 * The text and files live here rather than in `chat-store`: a broadcast is
 * written and sent in one sitting inside the sheet, and keying them by a list
 * id in a store keyed by CHAT ids would let the two collide.
 */
export function useBroadcastComposer(
  onSend: (draft: {
    body: string
    files: File[]
    linkPreviewUrl: string | null
    linkPreview: LinkPreview | null
  }) => void,
) {
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const link = useComposerLinkPreview(text, { enabled: files.length === 0 })

  const addFiles = useCallback(
    async (picked: FileList | File[] | null) => {
      const { accepted, rejected } = await intakeAttachments(picked, files.length)
      if (accepted.length > 0) setFiles((held) => [...held, ...accepted])
      if (rejected.length > 0) toastProblem(`${rejected.slice(0, 3).join('. ')}.`)
    },
    [files.length],
  )

  const removeFile = useCallback((index: number) => {
    setFiles((held) => held.filter((_, i) => i !== index))
  }, [])

  const submit = useCallback(() => {
    if (!text.trim() && files.length === 0) return
    const parsed = messageInputSchema.safeParse({ body: text, files })
    if (!parsed.success) {
      toastProblem(parsed.error.issues[0]?.message ?? 'That broadcast cannot be sent')
      return
    }
    onSend({
      body: text,
      files,
      linkPreviewUrl: files.length === 0 ? link.sendUrl : null,
      linkPreview: files.length === 0 ? link.preview : null,
    })
    // Cleared at once: the pending bubble in the thread owns the outcome now,
    // and a failure keeps it there with the text, ready to resend.
    setText('')
    setFiles([])
    link.reset()
  }, [text, files, link, onSend])

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        submit()
      }
    },
    [submit],
  )

  return {
    text,
    setText,
    files,
    addFiles,
    removeFile,
    linkPreviews: link.previews,
    isLinkPreviewLoading: link.isLoading,
    dismissLinkPreview: link.dismiss,
    canSend: text.trim().length > 0 || files.length > 0,
    submit,
    onKeyDown,
  }
}
