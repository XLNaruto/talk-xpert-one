import { Download, FileText, Music, Play } from 'lucide-react'
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

  return (
    <div
      className={cn(
        'grid gap-1',
        media.length > 1 && 'grid-cols-2',
        isUploading && 'opacity-70',
      )}
    >
      {media.map((item) => (
        <MediaItem
          key={`${item.id}-${item.position}`}
          media={item}
          siblings={media}
          isMine={isMine}
        />
      ))}

      {isUploading && (
        <div className="col-span-full">
          <div className="h-1 overflow-hidden rounded-full bg-black/20">
            <div
              className="h-full bg-current transition-[width]"
              style={{ width: `${Math.round((uploadProgress ?? 0) * 100)}%` }}
            />
          </div>
          <p className="mt-1 text-[10px] opacity-80">
            Uploading… {Math.round((uploadProgress ?? 0) * 100)}%
          </p>
        </div>
      )}
    </div>
  )
}

function MediaItem({
  media,
  siblings,
  isMine,
}: {
  media: MessageMedia
  siblings: MessageMedia[]
  isMine: boolean
}) {
  const mediaUrl = useMediaUrl()
  const openViewer = useMediaViewer()
  const src = mediaUrl(media.fileUrl)
  const poster = mediaUrl(media.thumbnailUrl)
  const label = mediaLabel(media)

  if (media.kind === 'image') {
    return (
      <button
        type="button"
        onClick={() => openViewer(siblings, media)}
        aria-label={`Open ${label}`}
        className="block cursor-zoom-in"
      >
        <img
          src={src}
          alt={label}
          loading="lazy"
          className="max-h-64 w-full rounded-lg object-cover"
          // An intrinsic size stops the thread jumping as each image decodes.
          width={media.width ?? undefined}
          height={media.height ?? undefined}
        />
      </button>
    )
  }

  if (media.kind === 'video') {
    return (
      <button
        type="button"
        onClick={() => openViewer(siblings, media)}
        aria-label={`Play ${label}`}
        className="relative block overflow-hidden rounded-lg bg-black/20"
      >
        {/* A frame, not a player: playback happens in the viewer. `preload` is
            metadata so this shows the first frame when the API gave no thumbnail,
            without pulling the whole file into a virtualised list. */}
        <video
          preload="metadata"
          muted
          playsInline
          poster={poster || undefined}
          className="max-h-64 w-full object-cover"
          tabIndex={-1}
        >
          <source src={src} type={media.mimeType ?? undefined} />
        </video>
        <span className="absolute inset-0 flex items-center justify-center bg-black/25">
          <span className="flex size-10 items-center justify-center rounded-full bg-black/55">
            <Play className="size-5 fill-white text-white" aria-hidden />
          </span>
        </span>
        {media.durationSeconds != null && (
          <span className="absolute right-1.5 bottom-1.5 rounded bg-black/60 px-1.5 text-[10px] text-white">
            {formatDuration(media.durationSeconds)}
          </span>
        )}
      </button>
    )
  }

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
