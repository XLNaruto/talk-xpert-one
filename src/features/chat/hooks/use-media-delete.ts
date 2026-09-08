import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Id } from '@/types/api'
import { MAX_MEDIA_DELETE } from '../constants'
import { mediaDeleteCopy, mediaDeleteWithdrawsMessage } from '../lib/chat-labels'
import type { ChatMessage, MediaDeleteResult } from '../types'

interface UseMediaDeleteInput {
  /**
   * The message the files belong to, taken LIVE from the thread — so a removal
   * that happened on another device redraws the picker instead of leaving it
   * offering a file that is already gone.
   */
  message: ChatMessage | null
  /**
   * Ticked when the panel opens: the one file a thumbnail's own button named.
   *
   * It also decides WHICH question is asked. A thumbnail already said which file
   * it means, so the panel confirms THAT file and shows it — asking a reader to
   * find the photo they just clicked in a grid of nine is asking them to pick it
   * twice. An empty list is the album's own menu, which named nothing, so the
   * panel has to ask.
   */
  preselected: Id[]
  onDelete: (messageId: Id, mediaIds: Id[]) => Promise<MediaDeleteResult | null>
  onClose: () => void
}

/**
 * The per-file delete panel's logic: what is ticked, what it will cost, and the
 * one call that carries it out.
 *
 * A multi-select rather than one request per thumbnail, because the API takes up
 * to a hundred ids in one go — and a batch is what makes the knock-on effects
 * arrive together: the message's `type` follows its first REMAINING file, so
 * removing three photos one at a time would move the bubble's kind twice on the
 * way to the answer.
 */
export function useMediaDelete({
  message,
  preselected,
  onDelete,
  onClose,
}: UseMediaDeleteInput) {
  const [selectedIds, setSelectedIds] = useState<Id[]>(preselected)
  const [isPending, setIsPending] = useState(false)

  /**
   * Drop ticks for files that are no longer on the message.
   *
   * The panel stays open across a failure, and `talk.message.media_deleted` from
   * another device can land underneath it — a tick on a file the server has
   * already removed would put an id in the batch that makes the whole call a 404
   * if it is the only one left.
   */
  const available = useMemo(
    () => new Set((message?.media ?? []).map((item) => String(item.id))),
    [message],
  )
  useEffect(() => {
    setSelectedIds((held) => {
      const kept = held.filter((id) => available.has(String(id)))
      return kept.length === held.length ? held : kept
    })
  }, [available])

  // The panel closes itself when there is nothing left to pick from — the last
  // file went, here or on another device.
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    if (message && message.media.length === 0) closeRef.current()
  }, [message])

  const toggle = useCallback((mediaId: Id) => {
    setSelectedIds((held) =>
      held.some((id) => String(id) === String(mediaId))
        ? held.filter((id) => String(id) !== String(mediaId))
        : held.length >= MAX_MEDIA_DELETE
          ? held
          : [...held, mediaId],
    )
  }, [])

  const copy = useMemo(
    () => (message ? mediaDeleteCopy(message, selectedIds) : null),
    [message, selectedIds],
  )

  /** True when confirming takes the whole bubble with it — the copy says so. */
  const withdrawsMessage = useMemo(
    () =>
      message !== null &&
      selectedIds.length > 0 &&
      mediaDeleteWithdrawsMessage(message, selectedIds),
    [message, selectedIds],
  )

  const submit = useCallback(async () => {
    if (!message || selectedIds.length === 0 || isPending) return
    setIsPending(true)
    const result = await onDelete(message.id, selectedIds)
    setIsPending(false)
    // A failure keeps the panel and its toast on screen, so the choice is not
    // silently lost. A 200 that deleted NOTHING — every id had already gone —
    // still closes it: the files are not there any more either way.
    if (result) closeRef.current()
  }, [message, selectedIds, isPending, onDelete])

  return {
    selectedIds,
    /** Whether the panel has to ask WHICH files, rather than only whether. */
    isPicking: preselected.length === 0 && (message?.media.length ?? 0) > 1,
    canSubmit: selectedIds.length > 0 && !isPending,
    isPending,
    withdrawsMessage,
    copy,
    toggle,
    submit,
  }
}
