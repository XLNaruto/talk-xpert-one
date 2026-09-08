import { create } from 'zustand'
import type { Slide } from 'yet-another-react-lightbox'
import type { Id } from '@/types/api'

/**
 * Where the slides came FROM, when that is a message the viewer can act on.
 *
 * Set for any bubble in the open thread, mine or not — the two deletes it
 * unlocks have different owners. Null only for the details sheet's gallery,
 * which is every attachment in the chat: `GET /talk/chats/:id/media` answers
 * files without saying which message each one hangs off, so there is no id to
 * name and the viewer is left with look, copy and download.
 *
 * `mediaIds` runs PARALLEL to `slides`, not to the message's media: audio and
 * documents have no slide, so the two arrays only line up once the unpreviewable
 * ones are filtered out — which is what turns the slide on screen into the id a
 * delete has to name.
 */
export interface MediaViewerSource {
  chatId: Id
  messageId: Id
  mediaIds: Id[]
  /**
   * Whether the PER-FILE delete may be offered — the sender's own right, and
   * theirs alone. False on somebody else's photo, which still offers the
   * whole-message hide, because that is MY copy and mine to drop.
   */
  canDeleteFile: boolean
}

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
  /** Null unless these slides are a message in the thread — see `MediaViewerSource`. */
  source: MediaViewerSource | null
  open: (slides: Slide[], index: number, source?: MediaViewerSource | null) => void
  setIndex: (index: number) => void
  close: () => void
}

export const useMediaViewerStore = create<MediaViewerState>()((set) => ({
  isOpen: false,
  slides: [],
  index: 0,
  source: null,
  open: (slides, index, source = null) => set({ isOpen: true, slides, index, source }),
  setIndex: (index) => set({ index }),
  // The slides are kept on close so the exit animation still has something to
  // draw; the next open replaces them wholesale.
  // The SOURCE goes, though — it is what enables a destructive button, and a
  // closed viewer holding one is a delete waiting to be aimed at a stale slide.
  close: () => set({ isOpen: false, source: null }),
}))
