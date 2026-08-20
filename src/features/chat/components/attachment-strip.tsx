import { useState } from 'react'
import { FileText, Image as ImageIcon, X } from 'lucide-react'
import { formatBytes } from '../lib/chat-labels'
import { useFilePreviews } from '../hooks/use-file-previews'

/**
 * The picked-but-not-yet-sent files, shown as a wrapping grid of thumbnails.
 *
 * An image or a video shows its own first frame, because "IMG_2481.jpg" tells
 * the sender nothing about which photo they just picked. Tiles wrap onto new
 * rows rather than scrolling sideways, so every pick stays visible at a glance;
 * past a few rows the block itself scrolls so it can never eat the composer.
 */
export function AttachmentStrip({
  files,
  onRemove,
}: {
  files: File[]
  onRemove: (index: number) => void
}) {
  const previews = useFilePreviews(files)

  if (files.length === 0) return null

  return (
    <ul className="mb-2 flex max-h-52 flex-wrap gap-2 overflow-y-auto px-1 pb-1">
      {files.map((file, index) => (
        <AttachmentTile
          key={`${file.name}-${file.size}-${index}`}
          file={file}
          preview={previews[index] ?? null}
          onRemove={() => onRemove(index)}
        />
      ))}
    </ul>
  )
}

function AttachmentTile({
  file,
  preview,
  onRemove,
}: {
  file: File
  preview: string | null
  onRemove: () => void
}) {
  // A codec the browser cannot decode fails at paint, not at URL creation, so
  // the fallback icon needs this as well as the type check upstream.
  const [failed, setFailed] = useState(false)
  const showImage = preview !== null && file.type.startsWith('image/') && !failed
  const showVideo = preview !== null && file.type.startsWith('video/') && !failed
  const Icon = file.type.startsWith('image/') ? ImageIcon : FileText

  return (
    <li className="relative w-28 shrink-0 rounded-lg border border-border bg-card p-1.5">
      <div className="mb-1 flex h-16 items-center justify-center overflow-hidden rounded-md bg-secondary">
        {showImage ? (
          <img
            src={preview}
            alt={file.name}
            onError={() => setFailed(true)}
            className="size-full object-cover"
          />
        ) : showVideo ? (
          <video
            src={preview}
            muted
            preload="metadata"
            onError={() => setFailed(true)}
            className="size-full object-cover"
          />
        ) : (
          <Icon className="size-6 text-muted-foreground" aria-hidden />
        )}
      </div>
      <p className="truncate text-[11px]" title={file.name}>
        {file.name}
      </p>
      <p className="text-[10px] text-muted-foreground">{formatBytes(file.size)}</p>

      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${file.name}`}
        // Inside the tile, not straddling its corner: the strip scrolls
        // vertically once it is several rows tall, and an overhanging button
        // would be clipped on the first and last row.
        className="absolute top-2 right-2 rounded-full border border-border bg-card/90 p-0.5 text-muted-foreground shadow-sm hover:text-destructive"
      >
        <X className="size-3" />
      </button>
    </li>
  )
}
