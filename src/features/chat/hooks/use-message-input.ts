import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ClipboardEvent, DragEvent, KeyboardEvent } from 'react'
import { ATTACHMENT_CONTENT_TYPES, MAX_ATTACHMENT_BYTES } from '@/lib/uploads'
import { toastProblem } from '@/lib/api-toast'
import { useChatStore } from '@/stores/chat-store'
import { useOnlineStatus } from '@/hooks/use-online-status'
import { keyOf } from '@/types/api'
import { useSendMessage } from '../api/use-send-message'
import { useMessageActions } from '../api/use-message-actions'
import { COMPOSER_MAX_HEIGHT_PX, MAX_ATTACHMENTS } from '../constants'
import { messageInputSchema } from '../schemas'
import { useTypingBroadcast } from './use-typing'
import type { Chat } from '../types'

/** HEIC/HEIF by name, for the photos a browser hands over with no MIME type. */
const HEIC_NAME = /\.(heic|heif)$/i

/**
 * Composer logic: the draft, the reply and edit targets, attachments, the typing
 * broadcast, validation and the send. `message-input.tsx` is markup only.
 */
export function useMessageInput(chat: Chat | null) {
  const chatId = chat?.id ?? null
  const draft = useChatStore((s) => (chatId == null ? '' : s.drafts[keyOf(chatId)] ?? ''))
  const replyTo = useChatStore((s) => (chatId == null ? null : s.replyTo[keyOf(chatId)] ?? null))
  const editing = useChatStore((s) => (chatId == null ? null : s.editing[keyOf(chatId)] ?? null))
  const setDraft = useChatStore((s) => s.setDraft)
  const clearDraft = useChatStore((s) => s.clearDraft)
  const setReplyTo = useChatStore((s) => s.setReplyTo)
  const setEditing = useChatStore((s) => s.setEditing)
  const blockedIds = useChatStore((s) => s.blockedTalkUserIds)

  const { send } = useSendMessage()
  const { edit } = useMessageActions()
  const { onActivity, stop: stopTyping } = useTypingBroadcast(chatId)
  const isOnline = useOnlineStatus()

  const [files, setFiles] = useState<File[]>([])
  const [isSending, setSending] = useState(false)
  const [isDragging, setDragging] = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Drag events fire per element, so a single boolean flickers off the moment the
  // pointer crosses a child. Counting enters against leaves is what keeps the
  // drop hint steady while the file moves over the strip and the buttons.
  const dragDepth = useRef(0)

  /**
   * Grow the box with the text, up to a cap, then scroll inside it.
   *
   * Measured in JS rather than with a CSS `field-sizing` because the cap has to
   * flip `overflow-y` too — a textarea that is both capped and `hidden` swallows
   * the end of a long paste with no way to reach it.
   */
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    const grown = Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT_PX)
    el.style.height = `${grown}px`
    el.style.overflowY = el.scrollHeight > COMPOSER_MAX_HEIGHT_PX ? 'auto' : 'hidden'
  }, [draft])

  /** Land in the composer when the thread changes — the next thing typed is a reply. */
  useEffect(() => {
    if (chatId != null) textareaRef.current?.focus()
  }, [chatId])

  /** Replying or editing puts the caret where the user is about to type. */
  useEffect(() => {
    if (replyTo || editing) textareaRef.current?.focus()
  }, [replyTo, editing])

  /**
   * Why the composer is closed, if it is.
   *
   * These are resolved BEFORE a file picker is offered, because the presign is
   * refused for exactly the same reasons a send is — better to explain than to
   * let the user pick a 20 MB video and then fail.
   */
  const blockedReason = useMemo((): string | null => {
    if (!chat) return null
    if (chat.self.hasLeft) {
      return chat.type === 'group'
        ? 'You left this group. Ask a member to add you back to post again.'
        : 'This conversation is no longer available.'
    }
    if (chat.self.isBlocked) {
      return 'The group owner has muted you here. You can still read the conversation.'
    }
    if (
      chat.type === 'direct' &&
      chat.counterpartTalkUserId !== null &&
      blockedIds.includes(chat.counterpartTalkUserId)
    ) {
      return 'You blocked this person. Unblock them to send a message.'
    }
    return null
  }, [chat, blockedIds])

  /** True when the only thing stopping the send is a block I can lift myself. */
  const canUnblock = Boolean(
    chat?.type === 'direct' &&
      chat.counterpartTalkUserId !== null &&
      blockedIds.includes(chat.counterpartTalkUserId) &&
      !chat.self.hasLeft,
  )

  const onChange = useCallback(
    (value: string) => {
      if (chatId == null) return
      setDraft(chatId, value)
      // Throttled inside the broadcast hook — this is safe to call per keystroke.
      if (!editing) onActivity()
    },
    [chatId, setDraft, onActivity, editing],
  )

  const addFiles = useCallback((picked: FileList | File[] | null) => {
    if (!picked) return
    // An iPhone photo often arrives with an empty `type`, which would then be
    // presigned as "" and rejected. Stamp it before anything else looks at it —
    // the PUT header has to match what was signed, so guessing once, here, keeps
    // the two ends agreeing.
    const incoming = [...picked].map((file) =>
      file.type === '' && HEIC_NAME.test(file.name)
        ? new File([file], file.name, { type: 'image/heic', lastModified: file.lastModified })
        : file,
    )
    if (incoming.length === 0) return

    // One bad file in a selection of fifteen does not throw the other fourteen
    // away: keep everything that can be sent, then say what was left out and
    // why. The presign signs a content type from a fixed enum and caps the size,
    // so both checks happen here rather than as a 400 after the wait.
    const rejected: string[] = []
    const sendable = incoming.filter((file) => {
      if (!(ATTACHMENT_CONTENT_TYPES as readonly string[]).includes(file.type)) {
        rejected.push(`${file.name} isn't a file type this chat accepts`)
        return false
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        rejected.push(`${file.name} is over 25 MB`)
        return false
      }
      return true
    })

    // Each file is a separate presign and PUT, so the cap is a real limit on how
    // long the send takes. The first ones in fill the room that is left and the
    // rest are named, never dropped silently.
    const room = Math.max(0, MAX_ATTACHMENTS - files.length)
    const accepted = sendable.slice(0, room)
    const overflow = sendable.length - accepted.length
    if (overflow > 0) {
      rejected.push(
        `${overflow} more didn't fit — ${MAX_ATTACHMENTS} files is the most one message can carry`,
      )
    }

    if (accepted.length > 0) {
      setFiles((held) => [...held, ...accepted])
      textareaRef.current?.focus()
    }
    // One toast for the batch: fifteen rejections would be fifteen toasts. Only
    // the first few are named, and the count of the rest is still stated.
    if (rejected.length > 0) {
      const shown = rejected.slice(0, 3).join('. ')
      const hidden = rejected.length - 3
      toastProblem(hidden > 0 ? `${shown}. And ${hidden} more.` : `${shown}.`)
    }
  }, [files.length])

  const removeFile = useCallback((index: number) => {
    setFiles((held) => held.filter((_, i) => i !== index))
  }, [])

  /**
   * Drop an emoji at the caret rather than at the end — a picker that always
   * appended would be unusable halfway through a sentence.
   */
  const insertEmoji = useCallback(
    (emoji: string) => {
      const el = textareaRef.current
      const start = el?.selectionStart ?? draft.length
      const end = el?.selectionEnd ?? start
      onChange(draft.slice(0, start) + emoji + draft.slice(end))
      // After React has written the new value, or the caret snaps to the end.
      requestAnimationFrame(() => {
        const at = start + emoji.length
        el?.focus()
        el?.setSelectionRange(at, at)
      })
    },
    [draft, onChange],
  )

  /** A screenshot on the clipboard becomes an attachment; pasted text is left alone. */
  const onPaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const pasted = [...event.clipboardData.files]
      if (pasted.length === 0) return
      event.preventDefault()
      addFiles(pasted)
    },
    [addFiles],
  )

  /**
   * Dropping files anywhere on the composer attaches them. The handlers are
   * returned as one object so the component spreads them onto its wrapper and
   * cannot wire half of them.
   */
  const dropZone = useMemo(() => {
    const carriesFiles = (event: DragEvent) =>
      [...event.dataTransfer.types].includes('Files')

    return {
      isDragging,
      onDragEnter: (event: DragEvent<HTMLDivElement>) => {
        if (!carriesFiles(event)) return
        dragDepth.current += 1
        setDragging(true)
      },
      onDragOver: (event: DragEvent<HTMLDivElement>) => {
        if (!carriesFiles(event)) return
        // Without this the browser navigates to the file instead of dropping it.
        event.preventDefault()
      },
      onDragLeave: () => {
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDragging(false)
      },
      onDrop: (event: DragEvent<HTMLDivElement>) => {
        if (!carriesFiles(event)) return
        event.preventDefault()
        dragDepth.current = 0
        setDragging(false)
        addFiles(event.dataTransfer.files)
      },
    }
  }, [isDragging, addFiles])

  // Starting an edit belongs to the thread (`useMessageThread.startEditing`) —
  // it is triggered from a bubble and writes the target into the store, which is
  // what this hook reads above. Only cancelling and saving live here.
  const cancelEditing = useCallback(() => {
    if (chatId == null) return
    setEditing(chatId, null)
    clearDraft(chatId)
  }, [chatId, setEditing, clearDraft])

  const cancelReply = useCallback(() => {
    if (chatId == null) return
    setReplyTo(chatId, null)
  }, [chatId, setReplyTo])

  const submit = useCallback(async () => {
    if (chatId == null || isSending || blockedReason) return

    // An edit is a different write with a different rule: text only, and only the
    // sender may do it. It never carries attachments.
    if (editing) {
      const body = draft.trim()
      if (!body) {
        toastProblem('An edited message still needs some text.')
        return
      }
      setSending(true)
      const ok = await edit(chatId, editing.messageId, body)
      setSending(false)
      if (ok) cancelEditing()
      return
    }

    const parsed = messageInputSchema.safeParse({ body: draft, files })
    if (!parsed.success) {
      toastProblem(parsed.error.issues[0]?.message ?? 'That message cannot be sent')
      return
    }

    setSending(true)
    stopTyping()
    const ok = await send({ chatId, body: draft, files, replyTo })
    setSending(false)

    // The draft is cleared only on success. A failed send keeps both the text and
    // the picked files, so the user can try again without retyping.
    if (ok) {
      clearDraft(chatId)
      setFiles([])
      setReplyTo(chatId, null)
      textareaRef.current?.focus()
    }
  }, [
    chatId,
    isSending,
    blockedReason,
    editing,
    draft,
    files,
    replyTo,
    edit,
    cancelEditing,
    send,
    stopTyping,
    clearDraft,
    setReplyTo,
  ])

  /**
   * Enter sends, Shift+Enter breaks the line, Escape backs out of whatever the
   * composer is currently pointed at — the edit first, then the reply.
   */
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Escape') {
        if (editing) {
          cancelEditing()
          return
        }
        if (replyTo) {
          cancelReply()
          return
        }
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        void submit()
      }
    },
    [editing, replyTo, cancelEditing, cancelReply, submit],
  )

  return {
    draft,
    onChange,
    textareaRef,
    onKeyDown,
    onPaste,
    insertEmoji,
    dropZone,
    files,
    addFiles,
    removeFile,
    replyTo,
    cancelReply,
    editing,
    cancelEditing,
    isSending,
    isOnline,
    blockedReason,
    canUnblock,
    canSend:
      chatId != null &&
      !blockedReason &&
      isOnline &&
      (draft.trim().length > 0 || files.length > 0),
    submit,
    stopTyping,
  }
}
