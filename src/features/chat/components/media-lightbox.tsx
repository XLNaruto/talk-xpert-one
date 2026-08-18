import { Suspense, lazy, useEffect } from 'react'
import { useMediaViewerStore } from '@/stores/media-viewer-store'

const MediaLightboxViewer = lazy(() => import('./media-lightbox-viewer'))

/**
 * The mount point for the full-screen media viewer — rendered once by
 * `chat-layout`, opened from anywhere via `useMediaViewer`.
 *
 * Nothing of the lightbox library is fetched until a photo is actually opened,
 * and it unmounts again on close so a closed viewer holds no decoded full-size
 * images.
 */
export function MediaLightbox() {
  const isOpen = useMediaViewerStore((s) => s.isOpen)
  const close = useMediaViewerStore((s) => s.close)

  // On a phone, the back gesture is what people reach for to leave a photo. Left
  // alone it would leave the conversation instead.
  useEffect(() => {
    if (!isOpen) return
    window.addEventListener('popstate', close)
    return () => window.removeEventListener('popstate', close)
  }, [isOpen, close])

  if (!isOpen) return null

  return (
    <Suspense fallback={null}>
      <MediaLightboxViewer />
    </Suspense>
  )
}
