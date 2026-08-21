import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ClipboardEvent, KeyboardEvent } from 'react'
import { toastProblem } from '@/lib/api-toast'
import { useChatStore } from '@/stores/chat-store'
import { useOnlineStatus } from '@/hooks/use-online-status'
import { keyOf } from '@/types/api'
import { useSendMessage } from '../api/use-send-message'
import { useMessageActions } from '../api/use-message-actions'
import { COMPOSER_MAX_HEIGHT_PX } from '../constants'
import { composerBlockedReason } from '../lib/chat-labels'
import { messageInputSchema } from '../schemas'
import { useAttachments } from './use-attachments'
import { useTypingBroadcast } from './use-typing'
import type { Chat } from '../types'

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

  // The picked files live in `chat-store`, because the drop target is the whole
  // thread pane and `chat-area.tsx` is what accepts the drop.
  const { files, addFiles: takeFiles, removeFile } = useAttachments(chatId)
  const [isSending, setSending] = useState(false)
  const sendingRef = useRef(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)

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

  /**
   * Replying or editing puts the caret where the user is about to type.
   *
   * On the NEXT frame, not in this effect's own pass: both actions are started
   * from a context menu, and Radix hands focus back to whatever opened it as it
   * closes — after this runs. Focusing straight away meant the composer lit up
   * and lost it again in the same tick. (The menu is also told not to restore
   * focus; this is the half that survives a menu that does.)
   *
   * An edit prefills the box, so the caret goes to the END of it — the reason
   * to reopen a sent message is usually to add to it, and selecting all of it
   * invites wiping it with the next keystroke.
   */
  useEffect(() => {
    if (!replyTo && !editing) return
    const frame = requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      const end = el.value.length
      el.setSelectionRange(end, end)
    })
    return () => cancelAnimationFrame(frame)
  }, [replyTo, editing])

  /**
   * Why the composer is closed, if it is.
   *
   * These are resolved BEFORE a file picker is offered, because the presign is
   * refused for exactly the same reasons a send is — better to explain than to
   * let the user pick a 20 MB video and then fail.
   */
  const blockedReason = useMemo(
    () => composerBlockedReason(chat, blockedIds),
    [chat, blockedIds],
  )

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

  /** Adding files also puts the caret back in the box — the next thing typed is
   *  the caption for what just landed. */
  const addFiles = useCallback(
    (picked: FileList | File[] | null) => {
      if (takeFiles(picked) > 0) textareaRef.current?.focus()
    },
    [takeFiles],
  )

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

  /**
   * Send, and let go.
   *
   * The composer does NOT wait for the server. `useSendMessage.send` puts the
   * optimistic bubble in the cache synchronously, before its first `await`, so by
   * the time this returns the message is already on screen wearing its `sending`
   * clock — and a failure flips that same bubble to `failed` with a retry on it
   * (rule 15). A spinner on the send button was reporting a round trip the thread
   * was already reporting better, and holding the text hostage while it ran.
   *
   * So the box is cleared FIRST and the send is fired without awaiting. What used
   * to be a race — text typed while the send was in flight, and the careful
   * unpicking of it afterwards — cannot arise: anything typed from here on was
   * typed into an already-empty composer and is simply the next message.
   *
   * The draft, files and reply target are read from the STORE rather than from
   * this render's closure. Two Enters inside one frame share a closure and would
   * read the same stale text; the store has already been emptied by the first.
   */
  const submit = useCallback(async () => {
    if (chatId == null || blockedReason) return

    // An edit is a different write with a different rule: text only, and only the
    // sender may do it. It never carries attachments — and it has no optimistic
    // bubble to report itself, so this is the one path that still waits.
    if (editing) {
      if (sendingRef.current) return
      const body = draft.trim()
      if (!body) {
        toastProblem('An edited message still needs some text.')
        return
      }
      sendingRef.current = true
      setSending(true)
      const ok = await edit(chatId, editing.messageId, body)
      sendingRef.current = false
      setSending(false)
      if (ok) cancelEditing()
      return
    }

    const state = useChatStore.getState()
    const key = keyOf(chatId)
    const body = state.drafts[key] ?? ''
    const attached = state.attachments[key] ?? []

    // Nothing to send is a no-op, not a complaint. An Enter on an empty composer
    // is something people do constantly, and a toast for it is noise.
    if (body.trim().length === 0 && attached.length === 0) return

    const parsed = messageInputSchema.safeParse({ body, files: attached })
    if (!parsed.success) {
      toastProblem(parsed.error.issues[0]?.message ?? 'That message cannot be sent')
      return
    }

    const quoted = state.replyTo[key] ?? null

    state.clearDraft(chatId)
    state.clearAttachments(chatId)
    setReplyTo(chatId, null)
    stopTyping()
    textareaRef.current?.focus()

    // Deliberately not awaited: the bubble in the thread owns the outcome now.
    void send({ chatId, body, files: attached, replyTo: quoted })
  }, [
    chatId,
    blockedReason,
    editing,
    draft,
    edit,
    cancelEditing,
    send,
    stopTyping,
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
