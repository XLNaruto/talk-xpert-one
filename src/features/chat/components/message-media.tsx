import { useCallback, useEffect, useState } from 'react'
import { Download, FileText, ImageOff, Music, Play } from 'lucide-react'
import { useMediaUrl } from '@/hooks/use-app-config'
import { cn } from '@/lib/utils'
import { useMediaViewer } from '../hooks/use-media-viewer'
import { formatBytes, formatDuration, mediaLabel } from '../lib/chat-labels'
import { isPreviewable } from '../lib/media-slides'
import type { MessageMedia } from '../types'
import { Tip } from '@/components/common/tip'

/**
 * Attachments on one bubble.
 *
 * Every `file_url` and `thumbnail_url` the API returns is a storage KEY despite
 * the naming, so all of them go through `useMediaUrl` — which prefixes the
 * server's `media_path`. A blob URL from an in-flight upload is passed straight
 * through by that helper, so the optimistic preview keeps working.
 *
 * Photos and videos open in the full-screen viewer rather than a new tab, and the
 * bubble's own attachments are the set it pages through.
 */
export function MessageMediaGrid({
  media,
  isMine,
  uploadProgress,
}: {
  media: MessageMedia[]
  isMine: boolean
  uploadProgress?: number
}) {
  if (media.length === 0) return null

  const isUploading = uploadProgress !== undefined && uploadProgress < 1
  // Photos and videos are laid out as one album; audio and documents are rows
  // under it, because a waveform or a filename has nothing to tile.
  const tiles = media.filter((m) => m.kind === 'image' || m.kind === 'video')
  const rows = media.filter((m) => m.kind !== 'image' && m.kind !== 'video')

  const percent = Math.round((uploadProgress ?? 0) * 100)

  return (
    <div className="flex flex-col gap-1" aria-busy={isUploading || undefined}>
      {tiles.length > 0 && (
        // While the bytes are still going up the album is the progress
        // indicator: the photos dim behind a scrim and the ring is drawn over
        // them, so the upload reads as happening TO these tiles rather than as a
        // separate bar under them. Clicks are off until it lands.
        <div className={cn('relative', isUploading && 'pointer-events-none')}>
          <MediaAlbum tiles={tiles} siblings={media} />
          {isUploading && (
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-sm bg-black/45 backdrop-blur-[1px]">
              <UploadRing percent={percent} />
              <span className="text-[10px] font-medium tracking-wide text-white/90">
                Uploading…
              </span>
            </span>
          )}
        </div>
      )}

      {/* Keyed on POSITION, never on the id. An attachment's id changes when the
          optimistic row is reconciled — the local preview's is a negative
          counter, the stored one's is the server's — and a changed key remounts
          the tile, which throws away the picture it was showing and refetches
          the replacement from nothing. Position is the same before and after. */}
      {rows.map((item, index) => (
        <MediaItem key={item.position ?? index} media={item} isMine={isMine} />
      ))}

      {/* A document or a voice note has no tile to draw on, so it keeps a bar. */}
      {isUploading && tiles.length === 0 && (
        <div className="flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-black/20">
            <div
              className="h-full rounded-full bg-current transition-[width] duration-200"
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className="shrink-0 text-[10px] tabular-nums opacity-80">{percent}%</span>
        </div>
      )}
    </div>
  )
}

/**
 * The upload ring — one SVG circle whose dash offset is the remaining bytes.
 *
 * A determinate ring rather than a spinner: the size is known up front (25 MB
 * ceiling, signed into the presigned URL), so the user gets to see the transfer
 * actually move instead of a shape that spins the same for one photo and for six.
 */
function UploadRing({ percent }: { percent: number }) {
  const radius = 18
  const circumference = 2 * Math.PI * radius
  const clamped = Math.min(100, Math.max(0, percent))

  return (
    <span
      className="relative flex size-11 items-center justify-center"
      role="progressbar"
      aria-label="Upload progress"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <svg viewBox="0 0 44 44" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="22" cy="22" r={radius} fill="none" stroke="currentColor" strokeWidth="3" className="text-white/25" />
        <circle
          cx="22"
          cy="22"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          className="text-white transition-[stroke-dashoffset] duration-200"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
        />
      </svg>
      <span className="text-[11px] font-semibold tabular-nums text-white">{clamped}%</span>
    </span>
  )
}

/** At most four tiles are drawn; the fourth carries a `+N` for the rest. */
const ALBUM_TILES = 4

/** Natural pixel size of a photo or a video frame, or null before it is known. */
type MediaSize = { w: number; h: number } | null

/**
 * Natural sizes we have already learnt, keyed by the attachment's own url.
 *
 * It has to outlive the component, and that is the whole point. A tile that
 * measures itself on load and keeps the answer in `useState` FORGETS it the
 * moment the row scrolls out of the virtualised window — and the thread is a
 * virtualised list, so that happens constantly. On the way back in the tile
 * reverted to the portrait fallback box, which is a different HEIGHT from the
 * landscape box it had settled into; the row changed size, that moved the edges
 * of the mounted window, which unmounted and remounted OTHER image rows, which
 * forgot and re-learnt their own sizes in turn.
 *
 * That is a feedback loop with nothing to damp it: the list reported a hundred
 * and fifty range changes every two seconds, indefinitely, with no scrolling, no
 * renders of our own and no data arriving. Learning a size once per attachment
 * per session is what breaks it — the second mount is the same shape as the
 * first, so nothing moves.
 *
 * Keyed on the url rather than on the message id because the id CHANGES under an
 * optimistic send (a local negative id becomes the server's), while a blob url
 * and a storage key each name one frame for as long as they exist.
 */
const naturalSizes = new Map<string, { w: number; h: number }>()

/** Bounded, because a long session in a media-heavy chat would otherwise keep
    every frame it ever drew. Oldest out first — the entries being lost are the
    ones furthest from the viewport. */
const NATURAL_SIZE_CAP = 500

function rememberNaturalSize(key: string, size: { w: number; h: number }): void {
  evictOldest(naturalSizes, NATURAL_SIZE_CAP)
  naturalSizes.set(key, size)
}

/**
 * Urls that have already decoded once in this session.
 *
 * A tile fades its picture in from a grey pulse, which is right the FIRST time —
 * it covers the wait. It is wrong every time after that, and in a virtualised
 * list "after that" is constant: a row that scrolls out of the mounted window
 * and back is a fresh mount with fresh state, so `state` began at `loading`, the
 * element was handed `opacity-0`, and a picture the browser could already paint
 * faded up from grey over 200ms. That is the blink — one per image per trip past
 * the fold, and nothing to do with the bytes, which had long since arrived.
 *
 * So the fade is spent once per url and never again. Keyed on the resolved url
 * because that is what the browser's own cache is keyed on: if it can paint
 * immediately, we must not ask it to fade.
 */
const decoded = new Set<string>()
const DECODED_CAP = 500

function evictOldest(store: Map<string, unknown> | Set<string>, cap: number): void {
  if (store.size < cap) return
  const oldest = store.keys().next()
  if (!oldest.done) store.delete(oldest.value as string)
}

/**
 * A LONE attachment is sized by its OWN frame — one photo in a bubble has
 * nothing to line up with, so neither cropping it nor padding it out to a
 * guessed shape is right.
 *
 * There is no fallback BOX any more, and that is the point. A fixed portrait box
 * for an unmeasured tile letterboxes every landscape photo the API did not
 * measure: on the first paint after a reload the frame flowed into a 4:5 well
 * and sat in the middle of it with a band of bubble above and below. The size
 * WAS learnt on decode, but applying it was deferred while the tile was on
 * screen — so the well only cleared on the tile's next mount, which is why
 * re-entering the chat drew the same photo correctly.
 *
 * So an unmeasured tile flows at its own proportions instead (`SOLO_FLUID`,
 * height from the picture, both axes capped) — right for a landscape frame and
 * for a portrait one, with nothing left over in either. A measured tile gets an
 * exact box from `soloBox()`, which is the SAME shape the fluid one settles
 * into, so learning a size never moves anything and the second visit matches the
 * first.
 *
 * An album keeps its squares — a grid wants them.
 */
const SOLO_MAX_WIDTH = 360
const SOLO_MAX_HEIGHT = 420

/** Shrink-to-fit around the picture, capped on both axes. */
const SOLO_FLUID = 'w-fit max-w-[360px] min-h-24 min-w-24'

/**
 * The exact box for a frame whose real proportions are known.
 *
 * A width plus the ratio rather than a width and a height: the bubble can be
 * narrower than the cap on a small screen, and an `aspect-ratio` keeps the box
 * matched to the photo as it clamps, where a fixed height would start
 * letterboxing again.
 */
function soloBox(size: { w: number; h: number }) {
  const scale = Math.min(1, SOLO_MAX_WIDTH / size.w, SOLO_MAX_HEIGHT / size.h)
  return { width: Math.round(size.w * scale), aspectRatio: `${size.w} / ${size.h}` }
}

/**
 * The album.
 *
 * One photo keeps its own proportions. Two, three or four become a tight grid —
 * a three-up leads with a full-width banner, like every chat client does — and
 * anything beyond the fourth collapses into a `+N` overlay on it. Clicking any
 * tile opens the viewer on the WHOLE bubble's media, hidden ones included, so
 * the overflow is reachable without a second screen.
 */
function MediaAlbum({
  tiles,
  siblings,
}: {
  tiles: MessageMedia[]
  siblings: MessageMedia[]
}) {
  const visible = tiles.slice(0, ALBUM_TILES)
  const extra = tiles.length - visible.length
  const count = visible.length
  // A single tile sets the bubble's width from its own frame, so the grid
  // shrinks to it (`w-fit`) instead of stretching it to the column.
  const solo = count === 1

  return (
    <div
      className={cn(
        // `rounded-sm` (8px), not the bubble's own `rounded-lg` (12px): the
        // album sits inside 4px of bubble padding, and a nested corner has to be
        // the outer radius MINUS that gap or the two curves run at different
        // rates and the photo reads as bulging out of its frame.
        'grid gap-0.5 overflow-hidden rounded-sm',
        solo ? 'w-fit max-w-full grid-cols-1' : 'w-64 max-w-full grid-cols-2',
      )}
    >
      {visible.map((item, index) => (
        <AlbumTile
          key={item.position ?? index}
          media={item}
          siblings={siblings}
          solo={solo}
          extraCount={index === visible.length - 1 ? extra : 0}
          className={cn(
            count > 1 && 'aspect-square',
            count === 3 && index === 0 && 'col-span-2 aspect-[2/1]',
          )}
        />
      ))}
    </div>
  )
}

function AlbumTile({
  media,
  siblings,
  solo,
  extraCount,
  className,
}: {
  media: MessageMedia
  siblings: MessageMedia[]
  solo: boolean
  extraCount: number
  className?: string
}) {
  const mediaUrl = useMediaUrl()
  const openViewer = useMediaViewer()
  const src = mediaUrl(media.fileUrl)
  const poster = mediaUrl(media.thumbnailUrl)
  const label = mediaLabel(media)
  const isVideo = media.kind === 'video'

  /**
   * Seeded from the payload when the API named the dimensions — which is the
   * common case and means the right box is picked on the FIRST paint, with no
   * reflow once the bytes decode. An optimistic row from a local file has
   * neither, so the element measures itself on load as the fallback — and what
   * it measures is kept in `naturalSizes`, so a row that scrolls away and back
   * comes back the SAME SHAPE. See that map for why it cannot be state alone.
   */
  const sizeKey = media.fileUrl
  const [size, setSize] = useState<MediaSize>(
    () =>
      (media.width && media.height ? { w: media.width, h: media.height } : null) ??
      naturalSizes.get(sizeKey) ??
      null,
  )

  /**
   * A measured frame, remembered and applied at once.
   *
   * Applying it used to be deferred while the tile was on screen, to keep a row
   * from changing height under the reader. That was protecting the wrong thing:
   * the height it was holding still was the WRONG height — the fallback box's —
   * so the cost of the deferral was a letterboxed photo until the next mount.
   *
   * Nothing needs holding still now, because the box it moves FROM is already
   * the right shape: an unmeasured tile flows at the picture's own proportions,
   * and `soloBox()` reproduces exactly those. The measurement buys the SECOND
   * paint a reserved box rather than the first paint a correction, which is why
   * it is still banked in `naturalSizes`.
   */
  const learnSize = useCallback(
    (next: MediaSize) => {
      if (!next) return
      const held = naturalSizes.get(sizeKey)
      if (held && held.w === next.w && held.h === next.h) return
      rememberNaturalSize(sizeKey, next)
      setSize(next)
    },
    [sizeKey],
  )

  // A solo tile with a known frame is an exact box, so the picture fills it and
  // `contain` never has anything to letterbox. Unmeasured, the picture IS the
  // box: it keeps its own height and the caps stop it running away.
  const fitClass = !solo
    ? 'size-full object-cover'
    : size
      ? 'size-full object-contain'
      : 'block h-auto w-auto max-h-[420px] max-w-full'

  return (
    <button
      type="button"
      onClick={() => openViewer(siblings, media)}
      aria-label={
        extraCount > 0 ? `Open ${label} and ${extraCount} more` : `Open ${label}`
      }
      style={solo && size ? { ...soloBox(size), maxWidth: '100%' } : undefined}
      className={cn(
        'relative block cursor-zoom-in overflow-hidden',
        // A grid tile fills its square, so its backdrop only ever shows while
        // the picture loads — black is fine there. A solo frame's box is the
        // photo's own shape, so its backdrop is only ever the loading plate: a
        // `--foreground` tint, which is a light plate on the dark bubble and a
        // soft grey one on the light bubble without naming either theme's colour.
        solo ? cn(!size && SOLO_FLUID, 'bg-foreground/10') : 'bg-black/15',
        className,
      )}
    >
      {isVideo ? (
        // A frame, not a player: playback happens in the viewer. `preload` is
        // metadata so this shows the first frame when the API gave no thumbnail,
        // without pulling the whole file into a virtualised list — and it is
        // also what reports the frame's size when the payload didn't.
        <video
          preload="metadata"
          muted
          playsInline
          poster={poster || undefined}
          className={fitClass}
          tabIndex={-1}
          onLoadedMetadata={(event) => {
            const element = event.currentTarget
            if (element.videoWidth && element.videoHeight) {
              learnSize({ w: element.videoWidth, h: element.videoHeight })
            }
          }}
        >
          <source src={src} type={media.mimeType ?? undefined} />
        </video>
      ) : (
        <TileImage
          src={src}
          alt={label}
          width={media.width}
          height={media.height}
          imgClassName={fitClass}
          onNaturalSize={learnSize}
        />
      )}

      {isVideo && extraCount === 0 && (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex size-9 items-center justify-center rounded-full bg-black/55">
            <Play className="size-4 fill-white text-white" aria-hidden />
          </span>
        </span>
      )}

      {isVideo && media.durationSeconds != null && extraCount === 0 && (
        <span className="absolute right-1.5 bottom-1.5 rounded bg-black/60 px-1.5 text-[10px] text-white">
          {formatDuration(media.durationSeconds)}
        </span>
      )}

      {extraCount > 0 && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-xl font-semibold text-white">
          +{extraCount}
        </span>
      )}
    </button>
  )
}

/**
 * A tile's photo, with somewhere to look while it is not one.
 *
 * A bare `<img>` whose src is empty or 404s draws the browser's broken-file
 * glyph next to the filename — the worst possible thing to show for a photo that
 * is merely still arriving. So an unloaded tile is a plain pulsing block and a
 * failed one says so with an icon, and neither is ever the broken glyph.
 */
function TileImage({
  src,
  alt,
  width,
  height,
  imgClassName,
  onNaturalSize,
}: {
  src: string
  alt: string
  width: number | null
  height: number | null
  imgClassName?: string
  /** Reports the decoded frame's size, for the tiles the payload left unmeasured. */
  onNaturalSize?: (size: MediaSize) => void
}) {
  // Seeded, not assumed: a url that has decoded before needs no fade and no
  // placeholder, so a remounted tile paints its picture in the first frame.
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>(() =>
    decoded.has(src) ? 'ready' : 'loading',
  )
  /**
   * The src on SCREEN, which lags the src in props by however long the new one
   * takes to decode.
   *
   * A sent photo changes src exactly once — the local blob is replaced by the
   * stored copy the moment the server's row lands — and pointing the element at
   * a URL the browser has not fetched blanks the tile until it arrives. That is
   * the flash you get after sending an image: photo, nothing, photo. So the
   * replacement is loaded off-screen first and only swapped in when it can be
   * drawn, which makes the change invisible.
   */
  const [shown, setShown] = useState(src)

  useEffect(() => {
    if (src === shown) return
    // Nothing worth holding on to — show the new one and let the tile's own
    // loading state cover it.
    if (!shown || state !== 'ready') {
      setShown(src)
      setState(src ? 'loading' : 'failed')
      return
    }

    let cancelled = false
    const image = new Image()
    const swap = (next: 'ready' | 'failed') => {
      if (cancelled) return
      setShown(src)
      setState(next)
    }
    image.onload = () => swap('ready')
    image.onerror = () => swap('failed')
    image.src = src
    return () => {
      cancelled = true
    }
  }, [src, shown, state])

  if (!src || (state === 'failed' && shown === src)) {
    // `min-h` because a landscape tile has no height of its own — it borrows the
    // picture's, and there is no picture here.
    return (
      <span className="flex size-full min-h-24 items-center justify-center bg-black/10">
        {src ? (
          <ImageOff className="size-5 opacity-60" aria-label={alt} />
        ) : (
          <span className="size-full animate-pulse bg-black/10" aria-label={alt} />
        )}
      </span>
    )
  }

  return (
    <>
      {state === 'loading' && (
        <span className="absolute inset-0 animate-pulse bg-black/10" aria-hidden />
      )}
      <img
        src={shown}
        alt={alt}
        // NOT `loading="lazy"`, and that is the opposite of the usual advice.
        // The virtualiser is already the thing deciding what gets loaded — a
        // tile only exists at all when its row is near the viewport. Handing the
        // browser a second, tighter threshold on top of that deferred the fetch
        // until the row was practically on screen, which put the decode (and so
        // the change of box shape it causes) in the reader's eyeline instead of
        // ahead of it. In the gallery grid, where every tile is mounted at once,
        // lazy loading still earns its keep.
        onLoad={(event) => {
          evictOldest(decoded, DECODED_CAP)
          decoded.add(shown)
          setState('ready')
          const element = event.currentTarget
          if (element.naturalWidth && element.naturalHeight) {
            onNaturalSize?.({ w: element.naturalWidth, h: element.naturalHeight })
          }
        }}
        onError={() => setState('failed')}
        className={cn(
          'transition-opacity duration-200',
          imgClassName ?? 'size-full object-cover',
          state === 'ready' ? 'opacity-100' : 'opacity-0',
        )}
        // An intrinsic size stops the thread jumping as each image decodes.
        width={width ?? undefined}
        height={height ?? undefined}
      />
    </>
  )
}

/** Audio and documents — the attachments an album cannot tile. */
function MediaItem({ media, isMine }: { media: MessageMedia; isMine: boolean }) {
  const mediaUrl = useMediaUrl()
  const src = mediaUrl(media.fileUrl)
  const label = mediaLabel(media)

  if (media.kind === 'audio') {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-black/10 px-2 py-1.5">
        <Music className="size-4 shrink-0" aria-hidden />
        <audio controls preload="metadata" className="h-8 min-w-0 flex-1">
          <source src={src} type={media.mimeType ?? undefined} />
          {label}
        </audio>
        {media.durationSeconds != null && (
          <span className="shrink-0 text-[10px] opacity-80">
            {formatDuration(media.durationSeconds)}
          </span>
        )}
      </div>
    )
  }

  const size = formatBytes(media.sizeBytes)
  return (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      // `download` on a cross-origin href is ignored by the browser, so this
      // opens the file and lets the storage host's headers decide — which is what
      // actually works for a presigned object.
      className={cn(
        'flex items-center gap-2 rounded-lg px-2 py-2',
        isMine ? 'bg-black/15' : 'bg-accent',
      )}
    >
      <FileText className="size-5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{label}</span>
        {size && <span className="block text-[10px] opacity-80">{size}</span>}
      </span>
      <Download className="size-4 shrink-0 opacity-70" aria-hidden />
    </a>
  )
}

/**
 * One tile in the details sheet's media gallery.
 *
 * `siblings` is everything the gallery loaded, not just the eight tiles on show,
 * so opening any photo lets you page through the whole conversation's media.
 * Audio and documents have nothing to preview and stay plain links.
 */
export function MediaThumb({
  media,
  siblings,
}: {
  media: MessageMedia
  siblings: MessageMedia[]
}) {
  const mediaUrl = useMediaUrl()
  const openViewer = useMediaViewer()
  const src = mediaUrl(media.thumbnailUrl || media.fileUrl)
  const label = mediaLabel(media)

  const inner = (
    <>
      {media.kind === 'image' || media.thumbnailUrl ? (
        <img src={src} alt={label} loading="lazy" className="size-full object-cover" />
      ) : (
        <span className="flex size-full items-center justify-center">
          {media.kind === 'audio' ? (
            <Music className="size-5 text-muted-foreground" />
          ) : (
            <FileText className="size-5 text-muted-foreground" />
          )}
        </span>
      )}
      {media.kind === 'video' && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/30">
          <Play className="size-5 fill-white text-white" aria-hidden />
        </span>
      )}
    </>
  )

  const tileClass = 'relative block aspect-square overflow-hidden rounded-md bg-accent'

  if (!isPreviewable(media)) {
    return (
      <Tip label={label}>
        <a
          href={mediaUrl(media.fileUrl)}
          target="_blank"
          rel="noopener noreferrer"
          className={tileClass}
        >
          {inner}
        </a>
      </Tip>
    )
  }

  return (
    <Tip label={label}>
      <button
        type="button"
        onClick={() => openViewer(siblings, media)}
        aria-label={`Open ${label}`}
        className={cn(tileClass, 'cursor-zoom-in')}
      >
        {inner}
      </button>
    </Tip>
  )
}
