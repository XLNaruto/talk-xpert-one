import { FileText, Music, Play } from 'lucide-react'
import { useMediaUrl } from '@/hooks/use-app-config'
import { cn } from '@/lib/utils'
import type { MessageQuote } from '../types'

/**
 * The picture on a quote — the thumbnail beside "Photo" on a reply.
 *
 * Nothing at all for a text quote or a tombstone, so the quote stays one line of
 * words in the common case. A kind with no picture to show (an audio file, a
 * document, a video the server sent no poster for) gets its icon on a plain tile
 * instead: the same footprint, so a run of replies does not step in and out.
 */
export function QuoteThumb({
  quote,
  className,
}: {
  quote: MessageQuote
  className?: string
}) {
  const mediaUrl = useMediaUrl()
  const kind = quote.mediaKind
  if (kind === null || quote.isDeleted) return null

  const source = quote.mediaThumbnail ? mediaUrl(quote.mediaThumbnail) : ''

  return (
    <span
      className={cn(
        'relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-black/10',
        className,
      )}
    >
      {source ? (
        <img
          src={source}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
        />
      ) : kind === 'audio' ? (
        <Music className="size-4 opacity-70" aria-hidden />
      ) : kind === 'video' ? (
        <Play className="size-4 opacity-70" aria-hidden />
      ) : (
        <FileText className="size-4 opacity-70" aria-hidden />
      )}
      {/* A poster frame is a still, and a still of a video is indistinguishable
          from a photo without this. */}
      {kind === 'video' && source && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/30">
          <Play className="size-3.5 text-white" aria-hidden />
        </span>
      )}
    </span>
  )
}
