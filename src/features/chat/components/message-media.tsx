import { useState } from 'react'
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
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg bg-black/45 backdrop-blur-[1px]">
              <UploadRing percent={percent} />
              <span className="text-[10px] font-medium tracking-wide text-white/90">
                Uploading…
              </span>
            </span>
          )}
        </div>
      )}

      {rows.map((item) => (
        <MediaItem key={`${item.id}-${item.position}`} media={item} isMine={isMine} />
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

  return (
    <div
      className={cn(
        'grid gap-0.5 overflow-hidden rounded-lg',
        count === 1 ? 'grid-cols-1' : 'w-64 max-w-full grid-cols-2',
      )}
    >
      {visible.map((item, index) => (
        <AlbumTile
          key={`${item.id}-${item.position}`}
          media={item}
          siblings={siblings}
          extraCount={index === visible.length - 1 ? extra : 0}
          className={cn(
            count === 1 && 'max-h-64',
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
  extraCount,
  className,
}: {
  media: MessageMedia
  siblings: MessageMedia[]
  extraCount: number
  className?: string
}) {
  const mediaUrl = useMediaUrl()
  const openViewer = useMediaViewer()
  const src = mediaUrl(media.fileUrl)
  const poster = mediaUrl(media.thumbnailUrl)
  const label = mediaLabel(media)
  const isVideo = media.kind === 'video'

  return (
    <button
      type="button"
      onClick={() => openViewer(siblings, media)}
      aria-label={
        extraCount > 0 ? `Open ${label} and ${extraCount} more` : `Open ${label}`
      }
      className={cn(
        'relative block cursor-zoom-in overflow-hidden bg-black/15',
        className,
      )}
    >
      {isVideo ? (
        // A frame, not a player: playback happens in the viewer. `preload` is
        // metadata so this shows the first frame when the API gave no thumbnail,
        // without pulling the whole file into a virtualised list.
        <video
          preload="metadata"
          muted
          playsInline
          poster={poster || undefined}
          className="size-full object-cover"
          tabIndex={-1}
        >
          <source src={src} type={media.mimeType ?? undefined} />
        </video>
      ) : (
        <TileImage
          src={src}
          alt={label}
          width={media.width}
          height={media.height}
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
}: {
  src: string
  alt: string
  width: number | null
  height: number | null
}) {
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')

  if (!src || state === 'failed') {
    return (
      <span className="flex size-full items-center justify-center bg-black/10">
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
        src={src}
        alt={alt}
        loading="lazy"
        onLoad={() => setState('ready')}
        onError={() => setState('failed')}
        className={cn(
          'size-full object-cover transition-opacity duration-200',
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
