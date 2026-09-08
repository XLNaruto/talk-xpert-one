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
 * straight to `onFiles`. A drag off a picture in ANOTHER TAB carries only a
 * LINK, and a textarea's default answer to that is to type the URL out as
 * message text. So a link to a sendable file is fetched back into a `File` and
 * attached like any other; a link to anything else is left alone and still
 * writes itself into the draft.
 *
 * A drag that STARTED IN THIS DOCUMENT is none of those, and it is refused
 * outright — the whole drop is swallowed, hint included. A photo in the thread
 * and a thumbnail in the delete picker are both `<img>`s, so the browser lets
 * them be dragged and hands the drop a `text/uri-list` pointing at our own
 * storage: indistinguishable from the other-tab case, and taken as one it
 * fetched the picture back and put it in the composer as a NEW attachment. So
 * dragging a photo a few pixels inside its own bubble queued it to be sent
 * again — one gesture with two meanings, and the destructive-looking one
 * happening by accident. `dragstart` only fires for a drag begun here, which is
 * exactly the test: no listener of ours runs for a drag from the desktop or
 * another tab.
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
  /**
   * Whether the drag in flight was begun on an element of OURS.
   *
   * A ref rather than state on purpose: it is read inside a drop handler in the
   * same gesture that sets it, and a re-render between the two would be a frame
   * in which the app disagreed with itself about what is being dragged.
   */
  const isInternalDrag = useRef(false)

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

    // Set for the whole of a drag begun HERE, and only such a drag: a file from
    // the desktop and a picture from another tab both start in a document this
    // listener is not bound to.
    const onWindowDragStart = () => {
      isInternalDrag.current = true
    }
    const onWindowDragEnd = () => {
      isInternalDrag.current = false
      stopDragging()
    }

    const onWindowDragOver = (event: NativeDragEvent) => {
      // NOT prevented for an internal drag, which is what makes the browser
      // refuse the drop and show the "no drop" cursor rather than letting one
      // land somewhere and be swallowed after the fact.
      if (isInternalDrag.current) return
      if (carriesFileList(event)) event.preventDefault()
    }
    const onWindowDrop = (event: NativeDragEvent) => {
      // A photo dragged out of the thread and let go anywhere in the app: the
      // default here is the TEXTAREA typing our own storage URL into the draft,
      // so it is cancelled even though nothing of ours acts on it.
      if (isInternalDrag.current) {
        event.preventDefault()
        isInternalDrag.current = false
        stopDragging()
        return
      }
      if (carriesFileList(event)) event.preventDefault()
      stopDragging()
    }
    // `relatedTarget` is null exactly when the pointer left the WINDOW — every
    // other dragleave is a child boundary the depth count already handles.
    const onWindowDragLeave = (event: NativeDragEvent) => {
      if (event.relatedTarget === null) stopDragging()
    }

    // Capture, so the flag is up before any handler of ours can read it —
    // `dragstart` bubbles from the image, and the pane's `dragenter` for the
    // same gesture follows immediately.
    window.addEventListener('dragstart', onWindowDragStart, true)
    window.addEventListener('dragover', onWindowDragOver)
    window.addEventListener('drop', onWindowDrop)
    window.addEventListener('dragleave', onWindowDragLeave)
    window.addEventListener('dragend', onWindowDragEnd)
    return () => {
      window.removeEventListener('dragstart', onWindowDragStart, true)
      window.removeEventListener('dragover', onWindowDragOver)
      window.removeEventListener('drop', onWindowDrop)
      window.removeEventListener('dragleave', onWindowDragLeave)
      window.removeEventListener('dragend', onWindowDragEnd)
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
        if (disabled || isInternalDrag.current || !carriesDrop(event)) return
        depth.current += 1
        setDragging(true)
      },
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (disabled || isInternalDrag.current || !carriesDrop(event)) return
        event.preventDefault()
      },
      onDragLeave: () => {
        if (disabled) return
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setDragging(false)
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        // The window guard cancels the browser's own answer to this one; there
        // is nothing here for the composer to take.
        if (isInternalDrag.current) return
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
