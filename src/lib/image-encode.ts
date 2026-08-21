/**
 * Encode an already-decoded `ImageBitmap` to a blob.
 *
 * Prefers `OffscreenCanvas.convertToBlob`, which lets the browser run the
 * expensive part — the encode — OFF the main thread, so a 12-megapixel photo
 * does not freeze the thread the message list scrolls on. Falls back to a plain
 * `<canvas>` where `OffscreenCanvas` is missing (Safari before 16.4).
 */
export async function encodeBitmapToBlob(
  source: ImageBitmap,
  width: number,
  height: number,
  type: string,
  quality?: number,
): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const offscreen = new OffscreenCanvas(width, height)
    const context = offscreen.getContext('2d')
    if (!context) throw new Error('Canvas 2D context unavailable')
    context.drawImage(source, 0, 0, width, height)
    return await offscreen.convertToBlob({ type, quality })
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D context unavailable')
  context.drawImage(source, 0, 0, width, height)
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Image encode failed'))),
      type,
      quality,
    ),
  )
}
