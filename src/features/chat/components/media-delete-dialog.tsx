import { Check, FileText, Loader2, Music, Play, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/common/modal'
import { useMediaUrl } from '@/hooks/use-app-config'
import { cn } from '@/lib/utils'
import type { Id } from '@/types/api'
import { useMediaDelete } from '../hooks/use-media-delete'
import { formatBytes, mediaLabel } from '../lib/chat-labels'
import type { ChatMessage, MediaDeleteResult, MessageMedia } from '../types'

interface MediaDeleteDialogProps {
  /** The live message, so the picker redraws when its files change under it. */
  message: ChatMessage
  /** Ticked on open — the file a thumbnail's own button named, if any. */
  preselected: Id[]
  onDelete: (messageId: Id, mediaIds: Id[]) => Promise<MediaDeleteResult | null>
  onClose: () => void
  /**
   * The scrim's stacking layer, for the one caller that needs more than the
   * app's default: opened from inside the media lightbox, whose portal sits at
   * 9999, this would otherwise be drawn behind the photo it is asking about.
   */
  layerClassName?: string
}

/**
 * Take files off a message without withdrawing it.
 *
 * ONE panel for two gestures, and which one it draws is decided by what the
 * gesture already NAMED. A thumbnail's own trash button named a file, so the
 * panel shows THAT file and asks about it — a picker there would make the reader
 * find the photo they just clicked in a grid of nine and choose it a second
 * time. The album's overflow menu named nothing, so it is a picker: the API
 * takes up to a hundred ids at once, and one batch spares the reader watching
 * the bubble's kind change three times on the way to the answer.
 *
 * Either way the copy says the consequence, and where the last file is coming
 * off a bubble with no caption it says the message goes too rather than
 * promising only the photo does.
 */
export function MediaDeleteDialog({
  message,
  preselected,
  onDelete,
  onClose,
  layerClassName,
}: MediaDeleteDialogProps) {
  const {
    selectedIds,
    isPicking,
    canSubmit,
    isPending,
    withdrawsMessage,
    copy,
    toggle,
    submit,
  } = useMediaDelete({ message, preselected, onDelete, onClose })

  const selected = new Set(selectedIds.map(String))
  /** The files about to go — what the image-led confirmation draws. */
  const doomed = message.media.filter((item) => selected.has(String(item.id)))

  return (
    <Modal
      title={copy?.title ?? 'Delete files?'}
      description={isPicking ? 'Pick what comes off the message.' : undefined}
      icon={<Trash2 />}
      layerClassName={layerClassName}
      onClose={isPending ? () => {} : onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => void submit()} disabled={!canSubmit}>
            {isPending && <Loader2 className="animate-spin" />}
            {copy?.confirmLabel ?? 'Delete'}
          </Button>
        </>
      }
    >
      {isPicking ? (
        <ul className="mb-3 grid grid-cols-3 gap-2">
          {message.media.map((item) => (
            <li key={item.id}>
              <MediaPick
                media={item}
                isSelected={selected.has(String(item.id))}
                isDisabled={isPending}
                onToggle={() => toggle(item.id)}
              />
            </li>
          ))}
        </ul>
      ) : (
        // The file itself, big enough to recognise. It is the whole reason this
        // is not a bare sentence: "Delete this photo?" over a list of nine
        // identical filenames tells the sender nothing, and the picture tells
        // them everything.
        doomed.map((item) => (
          <MediaPreview key={item.id} media={item} isLone={doomed.length === 1} />
        ))
      )}

      {/* Only ever the consequence, never "are you sure?" — and it changes as
          the ticks do, because the last file off a captionless bubble takes the
          whole message with it. */}
      <p
        className={cn(
          'text-sm',
          isPicking ? 'text-left' : 'text-center',
          withdrawsMessage ? 'font-medium text-destructive' : 'text-muted-foreground',
        )}
      >
        {selectedIds.length === 0
          ? 'Nothing picked yet. Tick the files to remove.'
          : copy?.message}
      </p>

      {message.body?.trim() && selectedIds.length > 0 && !withdrawsMessage && (
        <p
          className={cn(
            'mt-2 text-xs text-muted-foreground',
            isPicking ? 'text-left' : 'text-center',
          )}
        >
          The caption stays.
        </p>
      )}
    </Modal>
  )
}

/**
 * The file that is about to go, drawn to be recognised rather than read.
 *
 * A photo gets its own proportions inside a capped box — cropping the thing you
 * are being asked to confirm is how a reader deletes the wrong picture — and
 * audio and documents, which have nothing to look at, keep a glyph, their name
 * and their size instead.
 */
function MediaPreview({ media, isLone }: { media: MessageMedia; isLone: boolean }) {
  const mediaUrl = useMediaUrl()
  const label = mediaLabel(media)
  const size = formatBytes(media.sizeBytes)
  const preview = mediaUrl(media.thumbnailUrl || media.fileUrl)
  const isVisual = media.kind === 'image' || media.kind === 'video'

  if (!isVisual || !preview) {
    return (
      <div className="mb-3 flex items-center gap-2 rounded-lg bg-accent px-3 py-2.5">
        {media.kind === 'audio' ? (
          <Music className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">{label}</span>
          {size && <span className="block text-[10px] text-muted-foreground">{size}</span>}
        </span>
      </div>
    )
  }

  return (
    <figure className="mb-3 flex flex-col items-center gap-1.5">
      <span
        className={cn(
          'relative overflow-hidden rounded-lg bg-accent',
          // One file gets the room; several stack smaller, so a batch of three
          // still fits the panel without scrolling to reach the buttons.
          isLone ? 'max-h-56' : 'max-h-28',
        )}
      >
        <img
          src={preview}
          alt={label}
          draggable={false}
          className={cn('block w-auto max-w-full object-contain', isLone ? 'max-h-56' : 'max-h-28')}
        />
        {media.kind === 'video' && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/25">
            <Play className="size-7 fill-white text-white drop-shadow" aria-hidden />
          </span>
        )}
      </span>
      <figcaption className="max-w-full truncate text-[11px] text-muted-foreground">
        {label}
        {size && ` · ${size}`}
      </figcaption>
    </figure>
  )
}

/**
 * One file, as a target rather than a checkbox beside a name.
 *
 * A photo is recognised by looking at it, so the tile IS the control and the
 * tick sits on top of it. Audio and documents have nothing to look at and keep
 * their glyph and filename.
 */
function MediaPick({
  media,
  isSelected,
  isDisabled,
  onToggle,
}: {
  media: MessageMedia
  isSelected: boolean
  isDisabled: boolean
  onToggle: () => void
}) {
  const mediaUrl = useMediaUrl()
  const label = mediaLabel(media)
  const size = formatBytes(media.sizeBytes)
  const preview = mediaUrl(media.thumbnailUrl || media.fileUrl)
  const isVisual = media.kind === 'image' || media.kind === 'video'

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={isDisabled}
      aria-pressed={isSelected}
      aria-label={isSelected ? `Keep ${label}` : `Remove ${label}`}
      className={cn(
        'relative block aspect-square w-full overflow-hidden rounded-lg border-2 bg-accent text-left transition-colors',
        isSelected ? 'border-destructive' : 'border-transparent hover:border-border',
        isDisabled && 'opacity-60',
      )}
    >
      {isVisual && preview ? (
        <img
          src={preview}
          alt={label}
          loading="lazy"
          // Nothing here is a drag handle. Dragging the picture out lands a copy
          // of the file in the composer, which is the opposite of the answer
          // being asked for.
          draggable={false}
          className="size-full object-cover"
        />
      ) : (
        <span className="flex size-full flex-col items-center justify-center gap-1 px-1.5 text-center">
          {media.kind === 'audio' ? (
            <Music className="size-5 text-muted-foreground" aria-hidden />
          ) : (
            <FileText className="size-5 text-muted-foreground" aria-hidden />
          )}
          <span className="line-clamp-2 text-[10px] font-medium wrap-anywhere">{label}</span>
          {size && <span className="text-[10px] text-muted-foreground">{size}</span>}
        </span>
      )}

      {media.kind === 'video' && (
        <span className="absolute inset-0 flex items-center justify-center">
          <Play className="size-5 fill-white text-white drop-shadow" aria-hidden />
        </span>
      )}

      {/* A tick, not a cross: the mark says "this one is picked", and what
          happens to the picked ones is the button's job to say. */}
      <span
        className={cn(
          'absolute top-1 right-1 flex size-5 items-center justify-center rounded-full border transition-colors',
          isSelected
            ? 'border-destructive bg-destructive text-destructive-foreground'
            : 'border-white/70 bg-black/35 text-transparent',
        )}
        aria-hidden
      >
        <Check className="size-3" />
      </span>
    </button>
  )
}
