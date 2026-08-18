import { Pin, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Id } from '@/types/api'
import { mediaLabel } from '../lib/chat-labels'
import type { ChatMessage } from '../types'

/**
 * The pin bar above the thread.
 *
 * A pinned message is pinned for EVERYONE in the chat — a different feature from
 * pinning the chat itself to your own list, which nobody else sees. Only the most
 * recent pin is shown, with a count, because the bar must not eat the thread.
 */
export function PinnedBar({
  messages,
  onUnpin,
}: {
  messages: ChatMessage[]
  onUnpin: (messageId: Id) => void
}) {
  if (messages.length === 0) return null

  const [newest] = messages
  const text =
    newest.body?.trim() || (newest.media[0] ? mediaLabel(newest.media[0]) : 'Pinned message')

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border bg-secondary/60 px-3 py-1.5">
      <Pin className="size-3.5 shrink-0 text-primary" aria-hidden />
      <p className="min-w-0 flex-1 truncate text-xs">
        {text}
        {messages.length > 1 && (
          <span className="ml-1 text-muted-foreground">+{messages.length - 1} more</span>
        )}
      </p>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onUnpin(newest.id)}
        aria-label="Unpin this message"
      >
        <X />
      </Button>
    </div>
  )
}
