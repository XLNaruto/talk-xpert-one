import { useCallback } from 'react'
import { useMediaUrl } from '@/hooks/use-app-config'
import { useMediaViewerStore } from '@/stores/media-viewer-store'
import { previewableIndex, toMediaSlides } from '../lib/media-slides'
import type { MessageMedia } from '../types'

/**
 * Opens the full-screen viewer on a clicked attachment.
 *
 * `siblings` is the set the viewer can page through — the other attachments on
 * the same bubble, or the whole conversation's media when opened from the details
 * sheet's gallery. It is passed in rather than derived from the message cache
 * because "everything in this conversation" is not always what the person
 * clicked into, and the gallery already holds the wider list.
 */
export function useMediaViewer(): (siblings: MessageMedia[], clicked: MessageMedia) => void {
  const mediaUrl = useMediaUrl()
  const open = useMediaViewerStore((s) => s.open)

  return useCallback(
    (siblings, clicked) => {
      const slides = toMediaSlides(siblings, mediaUrl)
      if (slides.length === 0) return
      // A clicked item missing from its own sibling list would otherwise open at
      // -1 and render an empty viewer.
      const index = previewableIndex(siblings, clicked)
      open(slides, index < 0 ? 0 : index)
    },
    [mediaUrl, open],
  )
}
