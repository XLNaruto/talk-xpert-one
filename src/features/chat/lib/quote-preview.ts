import type { ChatMessage, MediaKind, MessageMedia, MessageQuote } from '../types'

/**
 * The attachment a quote should DRAW, rather than only name.
 *
 * A reply to a photo used to read "Photo", which says what was replied to but
 * not WHICH photo — in a run of eight pictures that is the one thing the reader
 * needs. So the quote carries the kind and a thumbnail key, and the two places
 * that render a quote (the inline one on a bubble, the bar above the composer)
 * both draw it.
 *
 * The FIRST attachment is the preview: an album's quote shows the album's cover,
 * the same tile the thread leads with, and the text beside it already says what
 * the message was.
 */
export function quoteMedia(media: MessageMedia[]): Pick<MessageQuote, 'mediaKind' | 'mediaThumbnail'> {
  const first = media[0]
  if (!first) return { mediaKind: null, mediaThumbnail: null }
  return { mediaKind: first.kind, mediaThumbnail: thumbnailKey(first) }
}

/**
 * What can be put in an `<img>`.
 *
 * An image is its own thumbnail when the server sent no separate one. A video is
 * NOT — its `file_url` is the movie, and an `<img>` pointed at it draws a broken
 * icon — so a video with no poster falls back to the kind's own icon. Audio and
 * documents never have one.
 */
function thumbnailKey(media: MessageMedia): string | null {
  if (media.thumbnailUrl) return media.thumbnailUrl
  return media.kind === 'image' ? media.fileUrl : null
}

/**
 * Fill in a quote's attachment from the thread's own copy of the message it
 * points at.
 *
 * The server's quote is a summary and carries no media, so without this a reply
 * loaded from history would show the picture only until the next reload. The
 * quote's OWN media still wins where it has any — that came from the payload and
 * is what the sender replied to, even if our copy has since been edited.
 */
export function withQuoteMedia(
  quote: MessageQuote,
  source: ChatMessage | undefined,
): MessageQuote {
  if (quote.mediaKind !== null || !source || source.media.length === 0) return quote
  return { ...quote, ...quoteMedia(source.media) }
}

/** The kind's own word, for the label beside a thumbnail that has no picture. */
export function mediaKindLabel(kind: MediaKind): string {
  switch (kind) {
    case 'image':
      return 'Photo'
    case 'video':
      return 'Video'
    case 'audio':
      return 'Audio'
    default:
      return 'Document'
  }
}
