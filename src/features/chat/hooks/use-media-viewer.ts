import { useCallback } from 'react'
import { useMediaUrl } from '@/hooks/use-app-config'
import { useMediaViewerStore } from '@/stores/media-viewer-store'
import type { Id } from '@/types/api'
import { isPreviewable, previewableIndex, toMediaSlides } from '../lib/media-slides'
import type { MessageMedia } from '../types'

/**
 * Which message the attachments belong to, so the viewer can act on it.
 *
 * Passed for any bubble in the thread; `canDeleteFile` is the narrower gate on
 * top, since taking a FILE off a message is the sender's right alone while
 * hiding my own copy of the whole thing is not. Omitted by the details sheet's
 * gallery, whose rows do not say which message each file hangs off.
 */
export interface MediaViewerOrigin {
  chatId: Id
  messageId: Id
  canDeleteFile: boolean
}

/**
 * Opens the full-screen viewer on a clicked attachment.
 *
 * `siblings` is the set the viewer can page through — the other attachments on
 * the same bubble, or the whole conversation's media when opened from the details
 * sheet's gallery. It is passed in rather than derived from the message cache
 * because "everything in this conversation" is not always what the person
 * clicked into, and the gallery already holds the wider list.
 */
export function useMediaViewer(): (
  siblings: MessageMedia[],
  clicked: MessageMedia,
  origin?: MediaViewerOrigin | null,
) => void {
  const mediaUrl = useMediaUrl()
  const open = useMediaViewerStore((s) => s.open)

  return useCallback(
    (siblings, clicked, origin) => {
      const slides = toMediaSlides(siblings, mediaUrl)
      if (slides.length === 0) return
      // A clicked item missing from its own sibling list would otherwise open at
      // -1 and render an empty viewer.
      const index = previewableIndex(siblings, clicked)
      open(
        slides,
        index < 0 ? 0 : index,
        // The ids are filtered the SAME way the slides are, so slide N and id N
        // are the same file — an unfiltered list would aim the delete button at
        // whichever document happened to sit at that position.
        origin
          ? {
              ...origin,
              mediaIds: siblings.filter(isPreviewable).map((item) => item.id),
            }
          : null,
      )
    },
    [mediaUrl, open],
  )
}
