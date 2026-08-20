import { Download, ZoomIn, ZoomOut } from 'lucide-react'
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
