import { create } from 'zustand'
import type { Slide } from 'yet-another-react-lightbox'

/**
 * The full-screen media viewer: which slides are loaded and which one is showing.
 *
 * A store rather than state in the viewer's own component because the thing that
 * opens it — a thumbnail deep inside a virtualised message list, or one in the
 * details sheet — is nowhere near the thing that renders it, which is mounted
 * once by `chat-layout`.
 *
 * Deliberately NOT persisted: a viewer left open across a reload would restore
 * over the thread pointing at URLs that may since have expired.
 */
interface MediaViewerState {
  isOpen: boolean
  slides: Slide[]
  index: number
  open: (slides: Slide[], index: number) => void
  setIndex: (index: number) => void
  close: () => void
}

export const useMediaViewerStore = create<MediaViewerState>()((set) => ({
  isOpen: false,
  slides: [],
  index: 0,
  open: (slides, index) => set({ isOpen: true, slides, index }),
  setIndex: (index) => set({ index }),
  // The slides are kept on close so the exit animation still has something to
  // draw; the next open replaces them wholesale.
  close: () => set({ isOpen: false }),
}))
