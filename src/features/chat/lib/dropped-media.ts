/**
 * A drop that carries a LINK rather than bytes.
 *
 * Dragging a picture out of the thread — or out of another tab — hands the
 * composer `text/uri-list`, not a `File`, and a textarea's default answer to
 * that is to type the URL out as message text. These two helpers are what turns
 * such a drop back into a file: decide whether the link points at something
 * this chat could send, then fetch it into a real `File` the presign can sign.
 */

/**
 * Extensions worth fetching back, kept in step with `ATTACHMENT_CONTENT_TYPES`.
 * A link to a page is still a link — only a link to a FILE is intercepted, so
 * dropping an ordinary URL keeps writing itself into the draft.
 */
const MEDIA_PATH =
  /\.(jpe?g|png|webp|gif|heic|heif|mp4|mov|webm|mp3|m4a|aac|ogg|wav|pdf|docx?|xlsx?|pptx?|txt|csv)(?:$|[?#])/i

/**
 * The one media URL in a dropped `text/uri-list` (or `text/plain`), if there is
 * one. The list is newline separated and may carry `#` comment lines.
 */
export function mediaUrlFromDrop(text: string | null | undefined): string | null {
  if (!text) return null

  const first = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('#'))
  if (!first) return null

  let url: URL
  try {
    url = new URL(first)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null

  return MEDIA_PATH.test(url.pathname) ? url.href : null
}

/**
 * The bytes behind a dropped link, as a `File`.
 *
 * Null rather than a throw when the object cannot be read — the media host is a
 * different origin, so a missing CORS header is an ordinary outcome and the
 * caller says so in one toast instead of a stack trace.
 */
export async function fileFromMediaUrl(url: string): Promise<File | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const blob = await response.blob()
    if (blob.size === 0) return null
    return new File([blob], filenameFromUrl(url), {
      type: blob.type,
      lastModified: Date.now(),
    })
  } catch {
    return null
  }
}

function filenameFromUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop()
    return last ? decodeURIComponent(last) : 'file'
  } catch {
    return 'file'
  }
}
