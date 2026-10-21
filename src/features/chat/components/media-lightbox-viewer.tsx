import { useCallback, useState } from 'react'
import { Play } from 'lucide-react'
import Lightbox from 'yet-another-react-lightbox'
import Thumbnails from 'yet-another-react-lightbox/plugins/thumbnails'
import Video from 'yet-another-react-lightbox/plugins/video'
import Zoom from 'yet-another-react-lightbox/plugins/zoom'
import 'yet-another-react-lightbox/styles.css'
import 'yet-another-react-lightbox/plugins/thumbnails.css'
import { useMediaUrl } from '@/hooks/use-app-config'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { useMediaViewerStore } from '@/stores/media-viewer-store'
import { useMessageCacheStore } from '@/stores/message-cache-store'
import { keyOf, type Id } from '@/types/api'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { useMessageActions } from '../api/use-message-actions'
import { messageHideCopy } from '../lib/chat-labels'
import { isPreviewable, toMediaSlides } from '../lib/media-slides'
import { MediaDeleteDialog } from './media-delete-dialog'
import {
  LightboxCloseButton,
  LightboxCopyButton,
  LightboxDeleteButton,
  LightboxDownloadButton,
  LightboxHideButton,
  LightboxNextButton,
  LightboxPrevButton,
  LightboxTitleBar,
  LightboxZoomButtons,
} from './media-lightbox-controls'

/**
 * Above the lightbox's own portal, which the library fixes at 9999 — a
 * confirmation drawn at the app's default layer would sit behind the photo it is
 * asking about.
 */
const DIALOG_LAYER = 'z-[10001]'

/**
 * The lightbox itself, in a module of its own so `media-lightbox` can `lazy()` it:
 * the library, three plugins and two stylesheets are a chunk nobody who never
 * opens a photo should pay for.
 *
 * The look — blurred backdrop, a title band naming the file and its place in the
 * set, square glass controls, a thumbnail strip — is `.xl-lightbox` in
 * `globals.css`; the controls themselves are `media-lightbox-controls`.
 *
 * `carousel: { finite: true }` because these slides are a conversation's history,
 * not a gallery — wrapping from the last photo back to the first would read as
 * new messages arriving.
 */
export default function MediaLightboxViewer() {
  const isOpen = useMediaViewerStore((s) => s.isOpen)
  const slides = useMediaViewerStore((s) => s.slides)
  const index = useMediaViewerStore((s) => s.index)
  const source = useMediaViewerStore((s) => s.source)
  const setIndex = useMediaViewerStore((s) => s.setIndex)
  const open = useMediaViewerStore((s) => s.open)
  const close = useMediaViewerStore((s) => s.close)
  const mediaUrl = useMediaUrl()
  const { deleteMedia, deleteForMe } = useMessageActions()
  const isMobile = useIsMobile()
  // A strip of one thumbnail is not a strip, and arrows with nowhere to go are
  // two dead buttons — both only earn their place once there is a set.
  const many = slides.length > 1

  /** Which file the toolbar's bin was pressed over. Null while nothing is asked. */
  const [deletingMediaId, setDeletingMediaId] = useState<Id | null>(null)
  /** Whether the whole-message hide is being confirmed. */
  const [isHiding, setHiding] = useState(false)
  const [isHidePending, setHidePending] = useState(false)

  /**
   * The message behind the slides, LIVE from the cache — so the confirmation
   * draws the file as the thread currently holds it, and closes itself if the
   * file goes for some other reason while the question is on screen.
   */
  const message = useMessageCacheStore((s) =>
    source === null
      ? null
      : (s.byChat[keyOf(source.chatId)] ?? []).find((m) => m.id === source.messageId) ?? null,
  )

  /**
   * Delete, then re-cut the reel.
   *
   * The slides were built from the message's attachments, so removing one leaves
   * the viewer holding a slide that no longer exists — a black frame, and a
   * counter that reads one too many. So the remaining media is re-sliced and the
   * index clamped to it, which lands the reader on the next photo the way a
   * gallery should; with nothing previewable left there is nothing to look at
   * and the viewer closes.
   */
  const onDelete = useCallback(
    async (messageId: Id, mediaIds: Id[]) => {
      if (source === null) return null
      const result = await deleteMedia(source.chatId, messageId, mediaIds)
      if (!result) return null

      const remaining = result.remainingMedia.filter(isPreviewable)
      if (remaining.length === 0 || result.messageDeleted) {
        close()
        return result
      }

      open(
        toMediaSlides(remaining, mediaUrl),
        Math.min(index, remaining.length - 1),
        { ...source, mediaIds: remaining.map((item) => item.id) },
      )
      return result
    },
    [source, deleteMedia, close, open, mediaUrl, index],
  )

  /**
   * Hide the whole message from my view.
   *
   * The viewer closes on success rather than re-slicing: unlike the per-file
   * delete there is nothing left to page through — the message and every file on
   * it have left this reader's thread.
   */
  const onHide = useCallback(async () => {
    if (source === null) return
    setHidePending(true)
    const ok = await deleteForMe(source.chatId, [source.messageId])
    setHidePending(false)
    if (!ok) return
    setHiding(false)
    close()
  }, [source, deleteForMe, close])

  return (
    <>
      <Lightbox
        open={isOpen}
        close={close}
        slides={slides}
        index={index}
        plugins={many ? [Video, Zoom, Thumbnails] : [Video, Zoom]}
        className="xl-lightbox"
        // The padding keeps the slide clear of the title band above and the
        // strip below; a phone gets a tighter frame, or the inset eats a third
        // of the screen.
        carousel={{ finite: true, padding: isMobile ? '56px' : '76px', imageFit: 'contain' }}
        // Only Close (or Esc) leaves — a stray click on the backdrop while
        // paging through a conversation's media should not throw the reader out.
        controller={{ closeOnBackdropClick: false }}
        thumbnails={
          isMobile
            ? { width: 64, height: 48, border: 0, gap: 6, padding: 2 }
            : { width: 96, height: 72, border: 0, gap: 8, padding: 4 }
        }
        zoom={{ maxZoomPixelRatio: 4, scrollToZoom: true }}
        animation={{ fade: 200, swipe: 350 }}
        toolbar={{
          buttons: [
            'zoom',
            <LightboxCopyButton key="copy" />,
            <LightboxDownloadButton key="download" />,
            // Last before Close, and the only destructive controls up there —
            // not something to reach for on the way to the download button.
            <LightboxDeleteButton
              key="delete"
              onRequestDelete={message ? setDeletingMediaId : undefined}
            />,
            // Beside it, never instead of it: one takes a file off the message
            // for everybody, the other drops my own copy of the whole thing.
            <LightboxHideButton
              key="hide"
              onRequestHide={message ? () => setHiding(true) : undefined}
            />,
            <LightboxCloseButton key="close" />,
          ],
        }}
        // A video keeps playing behind a closed lightbox otherwise.
        video={{ autoPlay: false, controls: true, playsInline: true, preload: 'metadata' }}
        // The index lives in the store, so the store is what has to move when the
        // person swipes — reading it back is what keeps arrows and counter in sync.
        on={{ view: ({ index: next }) => setIndex(next) }}
        render={{
          buttonZoom: LightboxZoomButtons,
          buttonPrev: many ? LightboxPrevButton : () => null,
          buttonNext: many ? LightboxNextButton : () => null,
          controls: () => <LightboxTitleBar count={slides.length} />,
          // A video with no poster has nothing for the strip to paint.
          thumbnail: ({ slide }) =>
            slide.type === 'video' && !slide.poster ? (
              <span className="xl-lightbox__thumb-icon grid size-full place-items-center rounded-md">
                <Play className="size-6" />
              </span>
            ) : undefined,
        }}
      />

      {/* Asked over the photo rather than after closing it: the picture behind
          the panel is the answer to "which file?". */}
      {deletingMediaId !== null && message && (
        <MediaDeleteDialog
          key={deletingMediaId}
          message={message}
          preselected={[deletingMediaId]}
          onDelete={onDelete}
          onClose={() => setDeletingMediaId(null)}
          layerClassName={DIALOG_LAYER}
        />
      )}

      {isHiding && message && (
        <ConfirmDialog
          {...messageHideCopy(message)}
          isPending={isHidePending}
          onConfirm={() => void onHide()}
          onCancel={() => setHiding(false)}
          layerClassName={DIALOG_LAYER}
        />
      )}
    </>
  )
}
