import { useCallback } from 'react'
import { toApiError } from '@/lib/api-error'
import { toastApiError, toastProblem } from '@/lib/api-toast'
import { logger } from '@/lib/logger'
import { useAuthStore } from '@/stores/auth-store'
import { useMessageCacheStore } from '@/stores/message-cache-store'
import type { Id } from '@/types/api'
import { draftMessage, mediaKindFor } from '../lib/chat-mappers'
import type { ChatMessage, MessageQuote, OutgoingMedia } from '../types'
import * as chatApi from './chat-api'

/** What the composer hands over. Files are still bytes at this point. */
export interface SendRequest {
  chatId: Id
  body: string
  files?: File[]
  replyTo?: MessageQuote | null
}

/**
 * Optimistic send.
 *
 * The bubble appears immediately as `sending`, is reconciled with the server's
 * row on success, and flips to `failed` — NOT removed — on error, so the user can
 * retry instead of losing what they typed.
 *
 * Two invariants make that safe:
 *
 *  - every send carries a `client_message_id`, which makes the request idempotent:
 *    a retry over a flaky connection answers the SAME message rather than posting
 *    a second bubble;
 *  - the cache reconciles on that id, so the `talk.message.new` echo of our own
 *    send — which the gateway delivers to us, because our socket is in the room —
 *    lands on the existing bubble instead of appending a duplicate.
 */
export function useSendMessage() {
  const talkUserId = useAuthStore((s) => s.identity?.talkUserId)
  const selfName = useAuthStore((s) => s.identity?.name)
  const selfPhoto = useAuthStore((s) => s.identity?.photo)
  const upsertOne = useMessageCacheStore((s) => s.upsertOne)
  const reconcile = useMessageCacheStore((s) => s.reconcile)
  const markFailed = useMessageCacheStore((s) => s.markFailed)
  const setUploadProgress = useMessageCacheStore((s) => s.setUploadProgress)

  const send = useCallback(
    async (request: SendRequest): Promise<boolean> => {
      if (talkUserId == null) return false

      const { chatId, body, files = [], replyTo } = request
      const clientMessageId = crypto.randomUUID()
      const trimmed = body.trim()

      // The placeholder carries the local previews so an image send shows the
      // picture straight away rather than a grey box that fills in later.
      const optimistic = draftMessage(chatId, talkUserId, {
        body: trimmed || null,
        media: files.map((file, index) => localPreview(file, index)),
        replyToMessageId: replyTo?.id ?? null,
        replyTo: replyTo ?? null,
        clientMessageId,
        senderName: selfName ?? null,
        senderPhoto: selfPhoto ?? null,
      })
      upsertOne(chatId, optimistic)

      try {
        const media = await uploadAll(chatId, files, (fraction) =>
          setUploadProgress(chatId, clientMessageId, fraction),
        )

        const saved = await chatApi.sendMessage({
          chatId,
          body: trimmed || null,
          media,
          replyToMessageId: replyTo?.id ?? null,
          clientMessageId,
        })

        reconcile(chatId, clientMessageId, saved)
        revokePreviews(optimistic)
        return true
      } catch (error) {
        markFailed(chatId, clientMessageId)
        toastApiError(error, sendFailureMessage(error))
        return false
      }
    },
    [talkUserId, selfName, selfPhoto, upsertOne, reconcile, markFailed, setUploadProgress],
  )

  /**
   * Retry a failed bubble.
   *
   * Text-only for now, deliberately: a failed attachment's `File` did not survive
   * the reload that a persisted `failed` row can outlive, so re-picking the file
   * is the honest path rather than sending a caption with a dead key.
   */
  const retry = useCallback(
    async (message: ChatMessage): Promise<boolean> => {
      if (message.media.length > 0) {
        toastProblem('Attach the file again to resend this message.')
        return false
      }
      return send({
        chatId: message.chatId,
        body: message.body ?? '',
        replyTo: message.replyTo,
      })
    },
    [send],
  )

  return { send, retry }
}

/** Upload each file and collect the keys the send needs. */
async function uploadAll(
  chatId: Id,
  files: File[],
  onProgress: (fraction: number) => void,
): Promise<OutgoingMedia[]> {
  if (files.length === 0) return []

  const uploaded: OutgoingMedia[] = []
  // Sequential on purpose: progress across a batch is only meaningful as one
  // number, and parallel PUTs of several 25 MB files would starve each other.
  for (const [index, file] of files.entries()) {
    const key = await chatApi.uploadAttachment(chatId, file, (fraction) =>
      onProgress((index + fraction) / files.length),
    )
    uploaded.push({
      kind: mediaKindFor(file.type),
      fileUrl: key,
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    })
  }
  return uploaded
}

/**
 * A local stand-in for an attachment while it uploads.
 *
 * The blob URL is revoked once the real row lands — an un-revoked one holds the
 * whole file in memory for the life of the tab.
 */
function localPreview(file: File, index: number) {
  const kind = mediaKindFor(file.type)
  const url = kind === 'image' ? URL.createObjectURL(file) : ''
  return {
    id: -(index + 1),
    kind,
    fileUrl: url,
    fileName: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    width: null,
    height: null,
    durationSeconds: null,
    thumbnailUrl: null,
    position: index,
  }
}

function revokePreviews(message: ChatMessage) {
  for (const media of message.media) {
    if (media.fileUrl.startsWith('blob:')) URL.revokeObjectURL(media.fileUrl)
  }
}

/**
 * A refused send has several causes and they need different words. A 403 is
 * deliberately vague when THEY blocked you — do not reveal it as a block.
 */
function sendFailureMessage(error: unknown): string {
  const { status, message } = toApiError(error)
  if (status === 403) return message || 'That message could not be delivered.'
  if (status === 404) return 'This conversation is no longer available.'
  if (status === 400) return message || 'That message could not be sent.'
  logger.warn('send failed', error)
  return 'Message not sent. Check your connection and try again.'
}
