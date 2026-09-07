import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { toastProblem } from '@/lib/api-toast'
import { fileFromMediaUrl, mediaUrlFromDrop } from '../lib/dropped-media'

/** The DOM event, spelled out because React's synthetic one owns the name here. */
type NativeDragEvent = globalThis.DragEvent

/**
 * Drag-and-drop onto an element, as a set of handlers to spread.
 *
 * The handlers are returned as one object so a component cannot wire half of
 * them — a missing `onDragOver` makes the browser navigate to the file instead
 * of dropping it.
 *
 * A window-wide guard rides along, and it is not optional. The handlers cover
 * the thread pane; the sidebar, the header chrome and every gap around them are
 * still the BROWSER's drop target, and its default answer to a file is to open
 * it — which for a `.pem` (or anything it will not render) is a download, so a
 * misaimed drag left the app and put a file in the user's Downloads folder. The
 * same event also never reaches the pane, so the counted drag depth was never
 * paid back and the "Drop files here" scrim stayed up over a chat that had
 * stopped listening. So a file drop ANYWHERE in the document is swallowed and
 * the hint is cleared — on the drop, on a drag that leaves the window, and on a
 * cancelled drag. Only `Files` are swallowed: a dragged LINK still has to reach
 * the textarea, which types it into the draft.
 *
 * Two payloads land here. A drag off the desktop carries `Files` and goes
 * straight to `onFiles`. A drag off a picture — one already in the thread, or
 * one in another tab — carries only a LINK, and a textarea's default answer to
 * that is to type the URL out as message text. So a link to a sendable file is
 * fetched back into a `File` and attached like any other; a link to anything
 * else is left alone and still writes itself into the draft.
 */
export function useFileDrop(
  onFiles: (files: FileList | File[]) => void,
  { disabled = false }: { disabled?: boolean } = {},
) {
  const [isDragging, setDragging] = useState(false)
  // The fetch behind a dropped link is a network round-trip, so the hint stays
  // up — and says what it is doing — until the bytes are in the strip.
  const [isFetchingLink, setFetchingLink] = useState(false)
  // Drag events fire per element, so a single boolean flickers off the moment
  // the pointer crosses a child. Counting enters against leaves is what keeps
  // the hint steady while the file moves over the bubbles and the composer.
  const depth = useRef(0)

  const stopDragging = useCallback(() => {
    depth.current = 0
    setDragging(false)
  }, [])

  /**
   * The browser's own drop behaviour, off — for the whole document.
   *
   * Bound once and independent of `disabled`: a composer that cannot take a file
   * is still no reason to hand the file to Chrome. `drop` fires on whatever was
   * under the pointer and bubbles to here, so the pane's own handler has already
   * run by the time this one does and only the misses are left to swallow.
   */
  useEffect(() => {
    const carriesFileList = (event: NativeDragEvent) =>
      Boolean(event.dataTransfer?.types.includes('Files'))

    const onWindowDragOver = (event: NativeDragEvent) => {
      if (carriesFileList(event)) event.preventDefault()
    }
    const onWindowDrop = (event: NativeDragEvent) => {
      if (carriesFileList(event)) event.preventDefault()
      stopDragging()
    }
    // `relatedTarget` is null exactly when the pointer left the WINDOW — every
    // other dragleave is a child boundary the depth count already handles.
    const onWindowDragLeave = (event: NativeDragEvent) => {
      if (event.relatedTarget === null) stopDragging()
    }

    window.addEventListener('dragover', onWindowDragOver)
    window.addEventListener('drop', onWindowDrop)
    window.addEventListener('dragleave', onWindowDragLeave)
    window.addEventListener('dragend', stopDragging)
    return () => {
      window.removeEventListener('dragover', onWindowDragOver)
      window.removeEventListener('drop', onWindowDrop)
      window.removeEventListener('dragleave', onWindowDragLeave)
      window.removeEventListener('dragend', stopDragging)
    }
  }, [stopDragging])

  const attachFromLink = useCallback(
    async (url: string) => {
      setFetchingLink(true)
      try {
        const file = await fileFromMediaUrl(url)
        if (!file) {
          // The drop carried a link, not bytes, and the media host is a
          // different origin with no CORS header — so the read behind that link
          // is refused and nothing here can recover it. Name the one route that
          // does work rather than implying the drag might succeed on a retry.
          toastProblem('That drop carried only a link, and the file behind it is out of reach. Download it, then attach the file.')
          return
        }
        onFiles([file])
      } finally {
        setFetchingLink(false)
      }
    },
    [onFiles],
  )

  const handlers = useMemo(() => {
    // Only the TYPES are readable while a drag is in flight — the data itself
    // is withheld until the drop — so the hint is decided on those alone.
    const carriesFiles = (event: DragEvent) => [...event.dataTransfer.types].includes('Files')
    const carriesLink = (event: DragEvent) =>
      [...event.dataTransfer.types].includes('text/uri-list')
    const carriesDrop = (event: DragEvent) => carriesFiles(event) || carriesLink(event)

    return {
      onDragEnter: (event: DragEvent<HTMLElement>) => {
        if (disabled || !carriesDrop(event)) return
        depth.current += 1
        setDragging(true)
      },
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (disabled || !carriesDrop(event)) return
        event.preventDefault()
      },
      onDragLeave: () => {
        if (disabled) return
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setDragging(false)
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        if (disabled || !carriesDrop(event)) return

        // A link that isn't a file is a link: fall through with the default
        // intact so it still lands in the draft as text.
        const url = carriesFiles(event)
          ? null
          : mediaUrlFromDrop(
              event.dataTransfer.getData('text/uri-list') ||
                event.dataTransfer.getData('text/plain'),
            )
        if (!carriesFiles(event) && !url) return

        event.preventDefault()
        stopDragging()

        if (url) void attachFromLink(url)
        else onFiles(event.dataTransfer.files)
      },
    }
  }, [disabled, onFiles, attachFromLink, stopDragging])

  return {
    isDragging: (isDragging || isFetchingLink) && !disabled,
    isFetchingLink,
    dragHandlers: handlers,
  }
}
