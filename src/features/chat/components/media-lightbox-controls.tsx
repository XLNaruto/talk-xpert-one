import { useState, type ReactNode } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  EyeOff,
  Image as ImageIcon,
  Maximize,
  Minus,
  Plus,
  Trash2,
  Video as VideoIcon,
  X,
} from 'lucide-react'
import {
  stopNavigationEventsPropagation,
  useController,
  useLightboxState,
  useLoseFocus,
  useNavigationState,
} from 'yet-another-react-lightbox'
import type { ZoomRef } from 'yet-another-react-lightbox'
import type {} from 'yet-another-react-lightbox/plugins/zoom'
import { Tip } from '@/components/common/tip'
import { toastProblem, toastSuccess } from '@/lib/api-toast'
import { canCopyImages, copyImageToClipboard } from '@/lib/copy-image'
import { cn } from '@/lib/utils'
import { useMediaViewerStore } from '@/stores/media-viewer-store'
import type { Id } from '@/types/api'
import { downloadMedia, slideDownload } from '../lib/media-download'

/**
 * The lightbox's title band, toolbar and navigation, drawn by us so every control
 * shares one square glass shape (`.xl-lightbox .yarl__button` in `globals.css`)
 * and carries the app's `Tip` instead of the OS tooltip a `title` attribute
 * produces.
 *
 * The bubble needs a z-index above the lightbox portal (9999): a tooltip renders
 * in a portal of its own at the end of `body`, so the app's default layer would
 * put it behind the photo.
 */
const TOOLTIP_LAYER = 'z-[10000]'

/**
 * One control of the viewer.
 *
 * Pointer and key events stop here: the carousel swipes on drag, and that should
 * not happen because someone reached for a button. `useLoseFocus` hands focus
 * back to the lightbox when the button disables itself mid-press, so the arrow
 * keys keep paging.
 */
function LightboxButton({
  label,
  side = 'bottom',
  onClick,
  disabled,
  className,
  children,
}: {
  label: string
  side?: 'top' | 'bottom' | 'left' | 'right'
  onClick?: () => void
  disabled?: boolean
  className?: string
  children: ReactNode
}) {
  const { focus } = useController()
  const loseFocus = useLoseFocus(focus, disabled)

  return (
    <Tip label={label} side={side} className={TOOLTIP_LAYER}>
      <button
        type="button"
        aria-label={label}
        className={cn('yarl__button', className)}
        disabled={disabled}
        onClick={onClick}
        {...stopNavigationEventsPropagation()}
        {...loseFocus}
      >
        {children}
      </button>
    </Tip>
  )
}

/** Top-left band: what you're looking at, and where you are in the set. */
export function LightboxTitleBar({ count }: { count: number }) {
  const { currentSlide, currentIndex } = useLightboxState()

  return (
    <div className="xl-lightbox__title">
      <span className="xl-lightbox__glass grid size-9 shrink-0 place-items-center rounded-[10px]">
        {currentSlide?.type === 'video' ? (
          <VideoIcon className="size-4" />
        ) : (
          <ImageIcon className="size-4" />
        )}
      </span>
      <span className="xl-lightbox__name min-w-0 truncate text-sm font-medium">
        {currentSlide?.caption ?? 'Media'}
      </span>
      {count > 1 && (
        <span className="xl-lightbox__glass shrink-0 rounded-full px-2.5 py-1 text-xs font-medium tabular-nums">
          {currentIndex + 1} / {count}
        </span>
      )}
    </div>
  )
}

/**
 * Zoom out / level / in, replacing the Zoom plugin's pair of buttons.
 *
 * The live percentage doubles as "reset to fit" — the only way back to 1×
 * without spinning the wheel all the way down. The cluster is absent on a video
 * slide, where zoom does nothing.
 */
export function LightboxZoomButtons(zoom: ZoomRef) {
  if (zoom.disabled) return null

  return (
    <>
      <LightboxButton
        label="Zoom out"
        className="xl-lightbox__zoom-step"
        onClick={zoom.zoomOut}
        disabled={zoom.zoom <= zoom.minZoom}
      >
        <Minus className="size-5" />
      </LightboxButton>
      <LightboxButton
        label="Reset zoom"
        className="xl-lightbox__zoom xl-lightbox__zoom-step"
        onClick={() => zoom.changeZoom(zoom.minZoom)}
        disabled={zoom.zoom <= zoom.minZoom}
      >
        <Maximize className="size-3.5" />
        {Math.round(zoom.zoom * 100)}%
      </LightboxButton>
      <LightboxButton
        label="Zoom in"
        className="xl-lightbox__zoom-step"
        onClick={zoom.zoomIn}
        disabled={zoom.zoom >= zoom.maxZoom}
      >
        <Plus className="size-5" />
      </LightboxButton>
    </>
  )
}

/** Save the current slide. */
export function LightboxDownloadButton() {
  const { currentSlide } = useLightboxState()
  const target = slideDownload(currentSlide)

  return (
    <LightboxButton
      label="Download"
      disabled={!target}
      onClick={() => {
        if (target) void downloadMedia(target.url, target.filename)
      }}
    >
      <Download className="size-5" />
    </LightboxButton>
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
    <LightboxButton
      label="Copy image"
      disabled={copying}
      onClick={() => {
        setCopying(true)
        void copyImageToClipboard(source)
          .then(() => toastSuccess('Image copied'))
          .catch(() => toastProblem('That image could not be copied. Download it instead.'))
          .finally(() => setCopying(false))
      }}
    >
      <Copy className="size-5" />
    </LightboxButton>
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
    <LightboxButton label="Delete file" onClick={() => onRequestDelete(mediaId)}>
      <Trash2 className="size-5" />
    </LightboxButton>
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
    <LightboxButton label="Delete for me" onClick={onRequestHide}>
      <EyeOff className="size-5" />
    </LightboxButton>
  )
}

export function LightboxCloseButton() {
  const { close } = useController()

  return (
    <LightboxButton label="Close" onClick={close}>
      <X className="size-5" />
    </LightboxButton>
  )
}

/** Previous / next. The library keeps the arrow's placement; we keep its look. */
function LightboxNavButton({ action }: { action: 'prev' | 'next' }) {
  const { prev, next } = useController()
  const { prevDisabled, nextDisabled } = useNavigationState()
  const isPrev = action === 'prev'

  return (
    <LightboxButton
      label={isPrev ? 'Previous' : 'Next'}
      side={isPrev ? 'right' : 'left'}
      onClick={() => (isPrev ? prev() : next())}
      disabled={isPrev ? prevDisabled : nextDisabled}
      className={`yarl__navigation_${action}`}
    >
      {isPrev ? <ChevronLeft className="size-5" /> : <ChevronRight className="size-5" />}
    </LightboxButton>
  )
}

export function LightboxPrevButton() {
  return <LightboxNavButton action="prev" />
}

export function LightboxNextButton() {
  return <LightboxNavButton action="next" />
}
