import Lightbox from 'yet-another-react-lightbox'
import Counter from 'yet-another-react-lightbox/plugins/counter'
import DownloadPlugin from 'yet-another-react-lightbox/plugins/download'
import Video from 'yet-another-react-lightbox/plugins/video'
import Zoom from 'yet-another-react-lightbox/plugins/zoom'
import 'yet-another-react-lightbox/styles.css'
import 'yet-another-react-lightbox/plugins/counter.css'
import { useMediaViewerStore } from '@/stores/media-viewer-store'
import {
  LightboxCloseButton,
  LightboxDownloadButton,
  LightboxNextButton,
  LightboxPrevButton,
  LightboxZoomButtons,
} from './media-lightbox-controls'

/**
 * The lightbox itself, in a module of its own so `media-lightbox` can `lazy()` it:
 * the library, four plugins and two stylesheets are a chunk nobody who never
 * opens a photo should pay for.
 *
 * `carousel: { finite: true }` because these slides are a conversation's history,
 * not a gallery — wrapping from the last photo back to the first would read as
 * new messages arriving.
 */
export default function MediaLightboxViewer() {
  const isOpen = useMediaViewerStore((s) => s.isOpen)
  const slides = useMediaViewerStore((s) => s.slides)
  const index = useMediaViewerStore((s) => s.index)
  const setIndex = useMediaViewerStore((s) => s.setIndex)
  const close = useMediaViewerStore((s) => s.close)

  return (
    <Lightbox
      open={isOpen}
      close={close}
      slides={slides}
      index={index}
      plugins={[Video, Zoom, Counter, DownloadPlugin]}
      carousel={{ finite: true }}
      // A video keeps playing behind a closed lightbox otherwise.
      video={{ autoPlay: false, controls: true, playsInline: true, preload: 'metadata' }}
      counter={{ container: { style: { top: 'unset', bottom: 0 } } }}
      // The index lives in the store, so the store is what has to move when the
      // person swipes — reading it back is what keeps arrows and counter in sync.
      on={{ view: ({ index: next }) => setIndex(next) }}
      styles={{ container: { backgroundColor: 'rgb(0 0 0 / 0.92)' } }}
      // Every control is re-rendered so it carries the app's tooltip instead of
      // the OS one the library's `title` attribute produces.
      render={{
        buttonZoom: LightboxZoomButtons,
        buttonDownload: LightboxDownloadButton,
        buttonClose: LightboxCloseButton,
        buttonPrev: LightboxPrevButton,
        buttonNext: LightboxNextButton,
      }}
    />
  )
}
