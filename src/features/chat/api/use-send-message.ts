import { useCallback } from 'react'
import { useMediaUrl } from '@/hooks/use-app-config'
import { toastProblem } from '@/lib/api-toast'
import { logger } from '@/lib/logger'
import { useAuthStore } from '@/stores/auth-store'
import { useMessageCacheStore } from '@/stores/message-cache-store'
import type { Id } from '@/types/api'
import { draftMessage, mediaKindFor } from '../lib/chat-mappers'
import { sendFailure } from '../lib/send-failures'
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
  const mediaUrl = useMediaUrl()
  const talkUserId = useAuthStore((s) => s.identity?.talkUserId)
  const selfName = useAuthStore((s) => s.identity?.name)
  const selfPhoto = useAuthStore((s) => s.identity?.photo)
  const upsertOne = useMessageCacheStore((s) => s.upsertOne)
  const reconcile = useMessageCacheStore((s) => s.reconcile)
  const markFailed = useMessageCacheStore((s) => s.markFailed)
  const markSending = useMessageCacheStore((s) => s.markSending)
  const setUploadProgress = useMessageCacheStore((s) => s.setUploadProgress)

  /**
   * Upload, send, reconcile — the half that is identical for a first attempt and
   * for a retry.
   *
   * The bubble already exists in the cache by the time this runs, and it is
   * addressed by `clientMessageId` throughout: that id is what the upload
   * progress, the reconcile and the failure all land on, and replaying it is
   * what makes the send idempotent server-side.
   */
  const deliver = useCallback(
    async (
      chatId: Id,
      clientMessageId: string,
      payload: { body: string | null; files: File[]; replyToMessageId: Id | null },
      onSent?: (saved: ChatMessage) => void,
    ): Promise<boolean> => {
      try {
        const media = await uploadAll(chatId, payload.files, (fraction) =>
          setUploadProgress(chatId, clientMessageId, fraction),
        )

        const saved = await chatApi.sendMessage({
          chatId,
          body: payload.body,
          media,
          replyToMessageId: payload.replyToMessageId,
          clientMessageId,
        })

        reconcile(chatId, clientMessageId, saved)
        onSent?.(saved)
        return true
      } catch (error) {
        // The verdict lands ON the bubble rather than only in a toast: a toast
        // is gone in seconds, and the message it explains stays on screen for
        // the rest of the session.
        const failure = sendFailure(error)
        markFailed(chatId, clientMessageId, failure)
        // A refusal is already written under the bubble, in words, permanently
        // — toasting the same sentence on top of it is noise. A transport
        // failure only says "tap to retry" there, so it still gets the toast.
        if (failure.canRetry) toastProblem(failure.reason)
        else logger.warn('send refused', error)
        return false
      }
    },
    [reconcile, markFailed, setUploadProgress],
  )

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

      return deliver(
        chatId,
        clientMessageId,
        { body: trimmed || null, files, replyToMessageId: replyTo?.id ?? null },
        (saved) => revokePreviews(optimistic, saved, mediaUrl),
      )
    },
    [talkUserId, selfName, selfPhoto, upsertOne, deliver, mediaUrl],
  )

  /**
   * Retry a failed bubble — a REPLAY of that send, not a new one.
   *
   * The failed row's own `client_message_id` goes back out, which is the whole
   * reason every send carries one: if the first attempt actually reached the
   * server and only its response was lost, the server answers with the SAME
   * message instead of posting a second. A fresh id here would duplicate it for
   * real, and would leave the failed bubble stranded beside the new one.
   *
   * A REFUSED send (403/404) replays too. The same idempotency key against an
   * unchanged refusal fails identically, but the refusal is not always
   * unchanged — a block lifted or a suspension cleared makes the very same
   * message deliverable — so the button is offered and the reason under the
   * bubble is what sets the expectation.
   *
   * Text-only, deliberately: a failed attachment's `File` did not survive the
   * reload that a persisted `failed` row can outlive, so re-picking the file is
   * the honest path rather than sending a caption with a dead key.
   */
  const retry = useCallback(
    async (message: ChatMessage): Promise<boolean> => {
      if (message.media.length > 0) {
        toastProblem('Attach the file again to resend this message.')
        return false
      }
      // A row with no `clientMessageId` predates this cache — there is nothing
      // to replay against, so it is sent afresh.
      if (!message.clientMessageId) {
        return send({
          chatId: message.chatId,
          body: message.body ?? '',
          replyTo: message.replyTo,
        })
      }

      markSending(message.chatId, message.clientMessageId)
      return deliver(message.chatId, message.clientMessageId, {
        body: message.body,
        files: [],
        replyToMessageId: message.replyToMessageId ?? null,
      })
    },
    [send, deliver, markSending],
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
  // Videos get one too: the tile renders the picked file's first frame the same
  // way the stored copy will, so the album does not change shape on reconcile.
  const url = kind === 'image' || kind === 'video' ? URL.createObjectURL(file) : ''
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

/**
 * Drop the local previews once the SERVER's copies can be drawn.
 *
 * Revoking the moment the reconcile lands is too early: the bubble still shows
 * the blob for the frame or two before React swaps the src, and the stored image
 * behind the new src has not been fetched yet — so the tile went blank, then
 * broken, and only then showed the photo. Waiting for each replacement to load
 * (or fail) means the swap happens between two images that are both ready.
 *
 * The blob still has to go — an un-revoked one holds the whole file in memory
 * for the life of the tab — so a failed load revokes too rather than leaking.
 */
function revokePreviews(
  optimistic: ChatMessage,
  saved: ChatMessage,
  mediaUrl: (key: string | null | undefined) => string,
) {
  const blobs = optimistic.media
    .map((media) => media.fileUrl)
    .filter((url) => url.startsWith('blob:'))
  if (blobs.length === 0) return

  const release = () => blobs.forEach((url) => URL.revokeObjectURL(url))

  const replacements = saved.media
    .filter((media) => media.kind === 'image')
    .map((media) => mediaUrl(media.thumbnailUrl || media.fileUrl))
    .filter(Boolean)
  if (replacements.length === 0) {
    release()
    return
  }

  let pending = replacements.length
  const settle = () => {
    pending -= 1
    if (pending === 0) release()
  }
  for (const url of replacements) {
    const image = new Image()
    image.onload = settle
    image.onerror = settle
    image.src = url
  }
}
