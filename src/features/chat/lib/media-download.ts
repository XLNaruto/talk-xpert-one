import type { Slide } from 'yet-another-react-lightbox'

/**
 * What a slide should save as — the `{ url, filename }` pair `toMediaSlides`
 * puts on every slide, or nothing when the slide carries no downloadable source.
 */
export function slideDownload(slide: Slide | undefined): { url: string; filename?: string } | null {
  if (!slide) return null
  const { download } = slide
  if (typeof download === 'string') return { url: download }
  if (download && typeof download === 'object') return { url: download.url, filename: download.filename }
  if (slide.type === 'image' && slide.src) return { url: slide.src }
  return null
}

/**
 * Saves a storage object to disk.
 *
 * Fetched as a blob first, because the media host is a different origin and a
 * bare `<a download>` across origins is ignored — the browser navigates to the
 * file instead of saving it. When the fetch is refused (no CORS header on that
 * object) opening it in a new tab is the only thing left that isn't a dead
 * button.
 */
export async function downloadMedia(url: string, filename?: string): Promise<void> {
  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Download failed with ${response.status}`)
    const href = URL.createObjectURL(await response.blob())
    saveBlobUrl(href, filename)
    setTimeout(() => URL.revokeObjectURL(href), 30_000)
  } catch {
    window.open(url, '_blank', 'noopener')
  }
}

function saveBlobUrl(href: string, filename?: string) {
  const link = document.createElement('a')
  link.href = href
  link.rel = 'noopener'
  link.download = filename || ''
  link.click()
}
