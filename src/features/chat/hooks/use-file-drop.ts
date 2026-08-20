import { useCallback, useMemo, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { toastProblem } from '@/lib/api-toast'
import { fileFromMediaUrl, mediaUrlFromDrop } from '../lib/dropped-media'

/**
 * Drag-and-drop onto an element, as a set of handlers to spread.
 *
 * The handlers are returned as one object so a component cannot wire half of
 * them — a missing `onDragOver` makes the browser navigate to the file instead
 * of dropping it.
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

  const attachFromLink = useCallback(
    async (url: string) => {
      setFetchingLink(true)
      try {
        const file = await fileFromMediaUrl(url)
        if (!file) {
          toastProblem("That image couldn't be read from its link. Save it, then attach it.")
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
        depth.current = 0
        setDragging(false)

        if (url) void attachFromLink(url)
        else onFiles(event.dataTransfer.files)
      },
    }
  }, [disabled, onFiles, attachFromLink])

  return {
    isDragging: (isDragging || isFetchingLink) && !disabled,
    isFetchingLink,
    dragHandlers: handlers,
  }
}
