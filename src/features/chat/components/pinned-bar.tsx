import { List, Pin, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tip } from '@/components/common/tip'
import { cn } from '@/lib/utils'
import type { Id } from '@/types/api'
import { mediaLabel } from '../lib/chat-labels'
import { usePinnedCursor } from '../hooks/use-pinned-cursor'
import type { ChatMessage } from '../types'

/** How many stepper bars are drawn before the strip would become a smear. */
const MAX_STEPS = 6

/**
 * The pin bar above the thread.
 *
 * It draws the CHAT-WIDE pins alone. A private bookmark is pinned for me and
 * nobody else, so putting one here would claim the conversation had seen it —
 * those live in the sheet, labelled. Neither is the same feature as pinning the
 * chat itself to your own list.
 *
 * It shows ONE pin at a time with a stepper down the left, and clicking it goes
 * to that message and arms the next one. That is the whole navigation: a reader
 * with four pins clicks four times and has seen all four in context, which a
 * list of previews cannot do. The full list is still one button away for
 * scanning and unpinning.
 *
 * `total` is the server's count, which can exceed what we drew: a pin whose
 * message we have not loaded is still a pin.
 */
export function PinnedBar({
  messages,
  total,
  onOpenAll,
  onJump,
  onUnpin,
}: {
  messages: ChatMessage[]
  total: number
  onOpenAll: () => void
  onJump: (messageId: Id) => void
  onUnpin: (messageId: Id) => void
}) {
  const { current, index, count, step } = usePinnedCursor(messages, onJump)

  if (!current) return null

  const shown = Math.max(total, count)
  const text =
    current.body?.trim() || (current.media[0] ? mediaLabel(current.media[0]) : 'Pinned message')

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border bg-secondary/60 px-3 py-1.5">
      {/* The stepper reads as position, not decoration: full-height segments,
          the one on show lit. Capped, because forty pins would draw a smear. */}
      {count > 1 && (
        <div
          className="flex h-8 shrink-0 flex-col gap-0.5"
          aria-hidden
        >
          {Array.from({ length: Math.min(count, MAX_STEPS) }, (_, slot) => (
            <span
              key={slot}
              className={cn(
                'w-0.5 flex-1 rounded-full transition-colors',
                slot === Math.min(index, MAX_STEPS - 1) ? 'bg-primary' : 'bg-primary/25',
              )}
            />
          ))}
        </div>
      )}

      <Pin className="size-3.5 shrink-0 text-primary" aria-hidden />

      <button
        type="button"
        onClick={step}
        aria-label={`Go to pinned message ${index + 1} of ${shown}`}
        className="min-w-0 flex-1 cursor-pointer rounded-md px-1 py-0.5 text-left transition-colors hover:bg-accent/60"
      >
        <span className="block text-[11px] font-medium text-primary">
          {shown > 1 ? `Pinned message ${index + 1} of ${shown}` : 'Pinned message'}
        </span>
        <span className="block truncate text-xs text-foreground/80">{text}</span>
      </button>

      {shown > 1 && (
        <Tip label="Show all pinned messages">
          <Button variant="ghost" size="icon" onClick={onOpenAll} aria-label="Show all pinned messages">
            <List />
          </Button>
        </Tip>
      )}

      <Tip label="Unpin for everyone">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onUnpin(current.id)}
          aria-label="Unpin this message"
        >
          <X />
        </Button>
      </Tip>
    </div>
  )
}
