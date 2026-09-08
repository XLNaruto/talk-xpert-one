import { useState } from 'react'
import { Copy, Download, EyeOff, Trash2, ZoomIn, ZoomOut } from 'lucide-react'
import {
  CloseIcon,
  IconButton,
  NextIcon,
  PreviousIcon,
  cssClass,
  useController,
  useLightboxState,
  useNavigationState,
} from 'yet-another-react-lightbox'
import type { ZoomRef } from 'yet-another-react-lightbox'
import type {} from 'yet-another-react-lightbox/plugins/zoom'
import { Tip } from '@/components/common/tip'
import { toastProblem, toastSuccess } from '@/lib/api-toast'
import { canCopyImages, copyImageToClipboard } from '@/lib/copy-image'
import { useMediaViewerStore } from '@/stores/media-viewer-store'
import type { Id } from '@/types/api'
import { downloadMedia, slideDownload } from '../lib/media-download'

/**
 * The lightbox's toolbar and navigation buttons, redrawn so they carry the app's
 * `Tip` instead of the OS tooltip the library's `title` attribute produces.
 *
 * The library's own `IconButton` is kept — it is what gives these buttons the
 * lightbox's hit area, hover state and focus ring — with `title` cleared so the
 * native bubble doesn't show up underneath ours. `aria-label` still comes from
 * `label`, so nothing is lost for a screen reader.
 *
 * The bubble needs a z-index above the lightbox portal (9999): a tooltip renders
 * in a portal of its own at the end of `body`, so the app's default layer would
 * put it behind the photo.
 */
const TOOLTIP_LAYER = 'z-[10000]'

/**
 * `IconButton`'s label is a key into the library's own translation table, and
 * the copy button is ours — so the key is declared, the same way each of the
 * library's own plugins declares the label for the button it adds.
 */
declare module 'yet-another-react-lightbox' {
  interface Labels {
    'Copy image'?: string
    'Delete file'?: string
    'Delete for me'?: string
  }
}

function LightboxTip({ label, side = 'bottom', children }: Parameters<typeof Tip>[0]) {
  return (
    <Tip label={label} side={side} className={TOOLTIP_LAYER}>
      {children}
    </Tip>
  )
}

/** Zoom in / zoom out, replacing the Zoom plugin's pair of buttons. */
export function LightboxZoomButtons(zoom: ZoomRef) {
  return (
    <>
      <LightboxTip label="Zoom in">
        <IconButton
          label="Zoom in"
          title={undefined}
          icon={ZoomIn}
          disabled={zoom.disabled || zoom.zoom >= zoom.maxZoom}
          onClick={zoom.zoomIn}
        />
      </LightboxTip>
      <LightboxTip label="Zoom out">
        <IconButton
          label="Zoom out"
          title={undefined}
          icon={ZoomOut}
          disabled={zoom.disabled || zoom.zoom <= zoom.minZoom}
          onClick={zoom.zoomOut}
        />
      </LightboxTip>
    </>
  )
}

/** Save the current slide, replacing the Download plugin's button. */
export function LightboxDownloadButton() {
  const { currentSlide } = useLightboxState()
  const target = slideDownload(currentSlide)

  return (
    <LightboxTip label="Download">
      <IconButton
        label="Download"
        title={undefined}
        icon={Download}
        disabled={!target}
        onClick={() => {
          if (target) void downloadMedia(target.url, target.filename)
        }}
      />
    </LightboxTip>
  )
}

/**
 * Copy the photo on screen to the clipboard.
 *
 * Images only — there is nothing to put on a clipboard for a video, and a
 * button that is present but permanently dead reads as broken, so it is absent
 * on those slides instead of disabled. Absent too where the browser cannot take
 * an image at all.
 *
 * The fetch and the PNG encode are not instant on a large photo, so the button
 * holds its own pending flag: a second click while the first is still encoding
 * would pay for the whole thing twice.
 */
export function LightboxCopyButton() {
  const { currentSlide } = useLightboxState()
  const [copying, setCopying] = useState(false)
  const source = currentSlide?.type === 'video' ? null : slideDownload(currentSlide)?.url ?? null

  if (!source || !canCopyImages()) return null

  return (
    <LightboxTip label="Copy image">
      <IconButton
        label="Copy image"
        title={undefined}
        icon={Copy}
        disabled={copying}
        onClick={() => {
          setCopying(true)
          void copyImageToClipboard(source)
            .then(() => toastSuccess('Image copied'))
            .catch(() => toastProblem('That image could not be copied. Download it instead.'))
            .finally(() => setCopying(false))
        }}
      />
    </LightboxTip>
  )
}

/**
 * Take the file on screen off its message, from the viewer.
 *
 * The natural place for it: the slide IS one file, so there is nothing to pick
 * and nothing to mistake — where the bubble's own menu, over an album of nine,
 * can only offer a picker.
 *
 * Absent unless the viewer was opened from a bubble the reader SENT. The details
 * sheet's gallery lists the whole chat's attachments without saying which
 * message each one hangs off, so there is no `message_id` to name and the button
 * would have nothing to send — better absent than present and permanently dead.
 */
export function LightboxDeleteButton({
  onRequestDelete,
}: {
  /**
   * Undefined when the thread no longer holds the message — the cache is
   * bounded and a conversation paged out takes its rows with it, and a bin that
   * opens nothing is worse than no bin.
   */
  onRequestDelete?: (mediaId: Id) => void
}) {
  const source = useMediaViewerStore((s) => s.source)
  const { currentIndex } = useLightboxState()
  // The ids are filtered the same way the slides are, so the slide in view and
  // the id at its index are the same file.
  const mediaId = source?.mediaIds[currentIndex]

  // The per-file delete is the SENDER's alone — on somebody else's photo the
  // button is absent rather than disabled, because a 403 is the only thing it
  // could ever answer.
  if (!source?.canDeleteFile || mediaId === undefined || !onRequestDelete) return null

  return (
    <LightboxTip label="Delete file">
      <IconButton
        label="Delete file"
        title={undefined}
        icon={Trash2}
        onClick={() => onRequestDelete(mediaId)}
      />
    </LightboxTip>
  )
}

/**
 * Hide the whole message from MY view, from the viewer.
 *
 * Offered on ANY photo, including somebody else's — anyone may hide anything
 * they can see, and nobody is told. It is deliberately not per-file: "hide it
 * from me alone" is a whole-MESSAGE gesture in the API and there is no
 * per-reader variant of the per-file one, so the confirmation names every file
 * that goes rather than letting the reader lose an album expecting to lose a
 * photo.
 *
 * `EyeOff`, not a second bin: the two deletes sit side by side up here, and the
 * one that only changes MY view has to read differently from the one that
 * withdraws a file from everybody.
 */
export function LightboxHideButton({
  onRequestHide,
}: {
  /** Undefined when the thread no longer holds the message. */
  onRequestHide?: () => void
}) {
  const source = useMediaViewerStore((s) => s.source)

  if (!source || !onRequestHide) return null

  return (
    <LightboxTip label="Delete for me">
      <IconButton
        label="Delete for me"
        title={undefined}
        icon={EyeOff}
        onClick={onRequestHide}
      />
    </LightboxTip>
  )
}

export function LightboxCloseButton() {
  const { close } = useController()

  return (
    <LightboxTip label="Close">
      <IconButton label="Close" title={undefined} icon={CloseIcon} onClick={close} />
    </LightboxTip>
  )
}

export function LightboxPrevButton() {
  const { prev } = useController()
  const { prevDisabled } = useNavigationState()

  return (
    <LightboxTip label="Previous" side="top">
      <IconButton
        label="Previous"
        title={undefined}
        icon={PreviousIcon}
        className={cssClass('navigation_prev')}
        disabled={prevDisabled}
        onClick={() => prev()}
      />
    </LightboxTip>
  )
}

export function LightboxNextButton() {
  const { next } = useController()
  const { nextDisabled } = useNavigationState()

  return (
    <LightboxTip label="Next" side="top">
      <IconButton
        label="Next"
        title={undefined}
        icon={NextIcon}
        className={cssClass('navigation_next')}
        disabled={nextDisabled}
        onClick={() => next()}
      />
    </LightboxTip>
  )
}
