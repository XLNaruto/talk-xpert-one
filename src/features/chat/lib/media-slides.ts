import type { Slide } from 'yet-another-react-lightbox'
import { mediaLabel } from './chat-labels'
import type { MessageMedia } from '../types'

/**
 * Attachment → lightbox slide.
 *
 * Images and videos are the only kinds the lightbox can show: it has no audio
 * slide type and a document has nothing to look at, so both keep their inline
 * player / download row instead of being forced into a viewer.
 *
 * Every `fileUrl` and `thumbnailUrl` is a storage KEY, so a resolver is passed in
 * rather than read here — this file stays free of React and of store reads.
 */
export function isPreviewable(media: MessageMedia): boolean {
  return media.kind === 'image' || media.kind === 'video'
}

type ResolveUrl = (key: string | null | undefined) => string

export function toMediaSlides(media: MessageMedia[], resolveUrl: ResolveUrl): Slide[] {
  return media.filter(isPreviewable).map((item) => {
    const src = resolveUrl(item.fileUrl)
    const filename = mediaLabel(item)
    // The Download plugin fetches this itself, which is what makes a download of
    // a cross-origin storage object actually save rather than navigate.
    const download = { url: src, filename }

    if (item.kind === 'image') {
      return {
        type: 'image' as const,
        src,
        alt: filename,
        // Known dimensions let the lightbox reserve the right box before the
        // full-size image decodes, so opening a slide doesn't jump.
        width: item.width ?? undefined,
        height: item.height ?? undefined,
        download,
      }
    }

    return {
      type: 'video' as const,
      poster: resolveUrl(item.thumbnailUrl) || undefined,
      width: item.width ?? 1280,
      height: item.height ?? 720,
      sources: [{ src, type: item.mimeType ?? 'video/mp4' }],
      download,
    }
  })
}

/**
 * Where `target` lands among the previewable items of `media` — the slide index
 * to open at. `-1` when the target is not previewable.
 *
 * Matched on id AND position: one message can carry the same file twice, and the
 * id alone would then always resolve to the first copy.
 */
export function previewableIndex(media: MessageMedia[], target: MessageMedia): number {
  return media
    .filter(isPreviewable)
    .findIndex((item) => item.id === target.id && item.position === target.position)
}
