import { useState } from 'react'
import { Globe, Loader2, X } from 'lucide-react'
import { useMediaUrl } from '@/hooks/use-app-config'
import { cn } from '@/lib/utils'
import { linkDomain } from '../lib/link-preview'
import type { LinkPreview } from '../types'

/**
 * A link's card — under a bubble's text, and above a composer that is about to
 * send one.
 *
 * Drawn from the STORED card only: the server built it once while the sender
 * typed, and nobody's client fetches the linked site. Any field may be missing —
 * no image draws a card without a picture, no site name falls back to the
 * domain — so nothing here assumes the card is complete.
 */
export function LinkPreviewCard({
  preview,
  isMine = false,
  onDismiss,
  className,
}: {
  preview: LinkPreview
  /** On my own bubble the card sits on the brand fill, so it takes a darker wash. */
  isMine?: boolean
  /** The composer's ✕. Absent on a bubble, where the card is the message's. */
  onDismiss?: () => void
  className?: string
}) {
  const mediaUrl = useMediaUrl()
  const [imageFailed, setImageFailed] = useState(false)
  const image = imageFailed ? '' : mediaUrl(preview.imageUrl)
  const domain = linkDomain(preview.url)
  // The site's own name is the headline when there is no title to show.
  const title = preview.title ?? preview.siteName ?? domain

  const card = (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        // A row — picture on the left rail, words beside it — capped so a long
        // description cannot stretch the bubble past the link above it.
        'flex min-h-22 w-full max-w-[21rem] min-w-0 items-stretch overflow-hidden rounded-lg text-left transition-opacity hover:opacity-90',
        // In the composer every card is the SAME box, so a row of them lines up.
        onDismiss
          ? 'h-22 border border-border bg-card shadow-sm'
          : isMine
            ? 'bg-black/15'
            : 'bg-foreground/6',
        !onDismiss && className,
      )}
    >
      {/* The picture FILLS a fixed rail instead of sizing the card: a tall
          og:image (a logo on a white square) made one card taller than its
          neighbour. The text decides the height; the picture is cropped to it. */}
      {image && (
        <span className="relative w-28 shrink-0 self-stretch bg-black/10">
          <img
            src={image}
            alt=""
            loading="lazy"
            onError={() => setImageFailed(true)}
            className="absolute inset-0 size-full object-cover"
          />
        </span>
      )}
      {/* `w-0` for the same reason the reply quote uses it: truncating text
          must not size the bubble to the length of the description. */}
      <span className="flex w-0 min-w-0 flex-1 flex-col justify-center gap-0.5 px-3 py-2">
        <span className="line-clamp-1 text-[12.5px] font-semibold leading-snug">{title}</span>
        {preview.description && (
          <span className="line-clamp-2 text-[11.5px] leading-snug opacity-70">
            {preview.description}
          </span>
        )}
        <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] opacity-60">
          <Globe className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{domain}</span>
        </span>
      </span>
    </a>
  )

  if (!onDismiss) return card

  // In the composer the ✕ sits OUTSIDE the card's top-right corner, so it is
  // never mistaken for part of the site's picture or text.
  return (
    <div className={cn('flex items-start gap-1.5', className)}>
      {card}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Remove link preview"
        className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}

/**
 * The composer's row of cards — one per link, each with its own ✕ — or the
 * placeholder while the first is on its way. Scrolls sideways rather than
 * wrapping, so three cards never push the text box down.
 */
export function LinkPreviewStrip({
  previews,
  isLoading,
  onDismiss,
}: {
  previews: { url: string; card: LinkPreview }[]
  isLoading: boolean
  onDismiss: (url: string) => void
}) {
  if (previews.length === 0) {
    return isLoading ? (
      <div className="mb-2">
        <LinkPreviewPending />
      </div>
    ) : null
  }
  return (
    <div className="mb-2 flex gap-3 overflow-x-auto pb-1">
      {previews.map(({ url, card }) => (
        <LinkPreviewCard
          key={url}
          preview={card}
          onDismiss={() => onDismiss(url)}
          // One box for every card, so a row of them lines up whatever each
          // site's picture and text.
          className="w-80 max-w-full shrink-0"
        />
      ))}
    </div>
  )
}

/** The composer's placeholder while the server is building a card. */
export function LinkPreviewPending() {
  return (
    <p className="flex items-center gap-2 rounded-md border-l-2 border-primary bg-secondary px-2 py-1.5 text-xs text-muted-foreground">
      <Loader2 className="size-3 animate-spin" aria-hidden />
      Getting a preview of the link…
    </p>
  )
}
