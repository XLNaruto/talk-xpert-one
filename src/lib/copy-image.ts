import { encodeBitmapToBlob } from '@/lib/image-encode'

/**
 * Put an image on the system clipboard, given the URL it is displayed from.
 *
 * The original bytes are written straight through when the browser says it can
 * take that type — no re-encode, and a WebP stays a WebP. Otherwise it is
 * converted to PNG, which is the one format every browser accepts for an image
 * clipboard write; Chrome accepts nothing else.
 *
 * Throws rather than reporting: the caller knows whether a failure deserves a
 * toast. Two failures are expected in the wild and both land here — a browser
 * with no async clipboard, and a media object served without a CORS header, so
 * the bytes cannot be read at all.
 */

/** How many recently-copied images keep their bytes. */
const BLOB_CACHE_LIMIT = 8

/**
 * Fetched bytes, by URL, so copying the same photo twice is a clipboard write
 * and not a second download. Bounded — a long session in a photo-heavy chat
 * would otherwise hold every image it ever copied.
 */
const blobCache = new Map<string, Blob>()

async function fetchImageBlob(url: string): Promise<Blob> {
  const cached = blobCache.get(url)
  if (cached) return cached
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Image fetch failed with ${response.status}`)
  const blob = await response.blob()
  if (blobCache.size >= BLOB_CACHE_LIMIT) {
    const oldest = blobCache.keys().next()
    if (!oldest.done) blobCache.delete(oldest.value)
  }
  blobCache.set(url, blob)
  return blob
}

async function convertToPng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  try {
    return await encodeBitmapToBlob(bitmap, bitmap.width, bitmap.height, 'image/png')
  } finally {
    bitmap.close?.()
  }
}

function clipboardSupports(type: string): boolean {
  const supports = (ClipboardItem as unknown as { supports?: (type: string) => boolean }).supports
  return typeof supports === 'function' ? supports(type) : false
}

/** True where an image can be put on the clipboard at all — gates the menu item. */
export function canCopyImages(): boolean {
  return typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function'
}

export async function copyImageToClipboard(url: string): Promise<void> {
  if (!url) throw new Error('No image URL')
  if (!canCopyImages()) throw new Error('Clipboard image write unsupported')

  const blob = await fetchImageBlob(url)
  const originalType = blob.type || 'image/png'

  // Asked before it is attempted: a write of a type the browser refuses throws,
  // and the PNG re-encode that follows would have been paid for nothing.
  if (originalType !== 'image/png' && clipboardSupports(originalType)) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ [originalType]: blob })])
      return
    } catch {
      // Fall through to PNG.
    }
  }

  const png = originalType === 'image/png' ? blob : await convertToPng(blob)
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
}
