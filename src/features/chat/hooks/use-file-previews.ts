import { useEffect, useState } from 'react'

/**
 * HEIC/HEIF is an image the API accepts and no browser but Safari can paint, so
 * an object URL for one yields a broken thumbnail. The server converts it after
 * the upload; the composer shows an icon instead of pretending.
 */
const UNPAINTABLE = /^image\/(heic|heif)$/i

/**
 * Object URLs for the picked images and videos, one per file, revoked when the
 * list changes or the composer unmounts.
 *
 * A blob URL is a document-lifetime allocation — the browser holds the bytes
 * until it is revoked, so a user who picks and drops a dozen 20 MB videos while
 * writing would leak all of them without this cleanup. Creating and revoking in
 * the SAME effect is what keeps them paired: a URL memoised elsewhere is revoked
 * by StrictMode's double-invoke while the `<img>` still points at it.
 *
 * The array is positional: index `i` is the URL for `files[i]`, or `null` for a
 * file with nothing to show (a PDF, a zip, a HEIC).
 */
export function useFilePreviews(files: File[]): Array<string | null> {
  const [urls, setUrls] = useState<Array<string | null>>([])

  useEffect(() => {
    const made = files.map((file) =>
      (file.type.startsWith('image/') || file.type.startsWith('video/')) &&
      !UNPAINTABLE.test(file.type)
        ? URL.createObjectURL(file)
        : null,
    )
    setUrls(made)
    return () => {
      for (const url of made) if (url) URL.revokeObjectURL(url)
    }
  }, [files])

  return urls
}
