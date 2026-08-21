import { MessagesSquare } from 'lucide-react'

/**
 * The pane with NO thread open.
 *
 * A generic `EmptyState` sat here before: a grey glyph on a flat fill, which
 * read as a screen that had failed to load rather than one waiting for a
 * choice. This is the same invitation drawn as the product's own motif — a
 * conversation about to start.
 *
 * Four layers, all decorative and all `aria-hidden`, so a screen reader hears
 * only the heading and the sentence under it:
 *  1. two slow aurora blobs drifting behind the dot grid the thread itself uses
 *     (`thread-canvas`), so the empty pane belongs to the same surface;
 *  2. three pulse rings leaving the medallion on a stagger — the "ping" of a
 *     message going out;
 *  3. the medallion, floating, with a mini bubble either side of it (one
 *     incoming in card paint, one outgoing in brand) drifting out of phase;
 *  4. a typing trio, which is the cue that the app is live and waiting.
 *
 * Every animation resolves to its resting frame at 0%, so the global
 * reduced-motion rule freezes this into a clean static illustration rather than
 * an invisible one — only the rings drop out, and they are pure decoration.
 */
export function ChatEmpty() {
  return (
    <div className="thread-canvas relative flex h-full flex-col items-center justify-center overflow-hidden p-8 text-center">
      <span aria-hidden className="chat-empty-aurora absolute -top-20 left-1/4 size-72" />
      <span
        aria-hidden
        className="chat-empty-aurora chat-empty-aurora-lag absolute -bottom-24 right-1/4 size-80"
      />

      <div aria-hidden className="relative mb-7 flex size-24 items-center justify-center">
        <span className="chat-empty-ring" />
        <span className="chat-empty-ring" />
        <span className="chat-empty-ring" />

        <span className="chat-empty-medallion relative flex size-16 items-center justify-center rounded-[1.25rem] border border-border/70 bg-card text-primary shadow-sm">
          <MessagesSquare className="size-7" />
        </span>

        {/* The two mini bubbles keep the composer's own asymmetry — the
            incoming one squares its bottom-left, the outgoing its bottom-right
            — so the motif reads as a thread and not as floating pills. */}
        <span className="chat-empty-chip absolute -top-1 -left-7 rounded-full rounded-bl-sm border border-border/70 bg-card px-2 py-1.5 shadow-sm">
          <span className="block h-1 w-6 rounded-full bg-muted-foreground/35" />
        </span>
        <span className="chat-empty-chip chat-empty-chip-lag absolute -right-8 -bottom-1 rounded-full rounded-br-sm border border-primary/25 bg-primary/15 px-2 py-1.5 shadow-sm">
          <span className="block h-1 w-4 rounded-full bg-primary/60" />
        </span>
      </div>

      <p className="text-base font-semibold text-foreground">Pick a conversation</p>
      <p className="mt-1.5 max-w-xs text-sm text-muted-foreground">
        Choose someone from the list to read and reply.
      </p>

      <span aria-hidden className="mt-6 flex items-center gap-1.5">
        <span className="chat-empty-dot size-1.5 rounded-full bg-primary" />
        <span className="chat-empty-dot size-1.5 rounded-full bg-primary" />
        <span className="chat-empty-dot size-1.5 rounded-full bg-primary" />
      </span>
    </div>
  )
}
