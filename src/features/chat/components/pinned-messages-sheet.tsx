import { Loader2, PinOff } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/common/empty-state'
import { Modal } from '@/components/common/modal'
import { Tip } from '@/components/common/tip'
import { useMediaUrl } from '@/hooks/use-app-config'
import type { Id } from '@/types/api'
import { mediaLabel, DELETED_MESSAGE_TEXT } from '../lib/chat-labels'
import { formatChatTime } from '../lib/message-formatters'
import { systemMessageText } from '../lib/system-messages'
import { pinKey } from '../lib/chat-mappers'
import { resolveTalkUser } from '../lib/talk-directory'
import type { ChatMessage, PinnedMessage } from '../types'

export interface PinnedRow {
  pin: PinnedMessage
  message: ChatMessage
}

/**
 * Every pinned message in the conversation, newest PIN first — the order is when
 * somebody decided a message mattered, not when it was written.
 *
 * A sheet rather than the one-line bar above the thread, because the bar can only
 * carry the newest pin without eating the conversation. `GET /talk/chats/:id/pins`
 * returns each pinned message inline and pages, so a pin from months back draws
 * here without walking the history to find it.
 *
 * It holds BOTH kinds of pin, which is why each row says who it is for: the
 * chat-wide pin everybody sees, and my own private bookmark, which changes
 * nobody else's view and is never announced. A message pinned both ways is two
 * rows on purpose — unpinning one leaves the other standing.
 *
 * Neither is the same feature as pinning the CHAT to your own list.
 */
export function PinnedMessagesSheet({
  rows,
  total,
  selfTalkUserId,
  isLoading,
  isLoadingMore,
  hasMore,
  onLoadMore,
  onUnpin,
  onJump,
  onClose,
}: {
  rows: PinnedRow[]
  total: number
  selfTalkUserId: Id | null
  isLoading: boolean
  isLoadingMore: boolean
  hasMore: boolean
  onLoadMore: () => void
  /** `forEveryone` says WHICH pin to remove — the two are separate rows. */
  onUnpin: (messageId: Id, forEveryone: boolean) => void
  /** Close the sheet and land on the pin in the thread. */
  onJump: (messageId: Id) => void
  onClose: () => void
}) {
  return (
    <Modal
      title="Pinned messages"
      description={total > 0 ? `${total} in this conversation` : undefined}
      side="right"
      onClose={onClose}
    >
      {isLoading && rows.length === 0 ? (
        <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading pins…
        </p>
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nothing pinned yet"
          description="Right-click a message to pin it for everyone, or pin it just for me."
        />
      ) : (
        // Edge to edge: the sheet body is padded, so the list cancels it and each
        // row pays it back. A pin's hover band and click target then span the
        // full width of the sheet, the way a list of rows should read, rather
        // than floating as an inset card.
        <div className="-mx-4 divide-y divide-border/60">
          {rows.map((row) => (
            <PinnedRowItem
              key={pinKey(row.pin)}
              row={row}
              selfTalkUserId={selfTalkUserId}
              onUnpin={onUnpin}
              onJump={onJump}
            />
          ))}

          {hasMore && (
            <div className="px-4 py-3 text-center">
              <Button variant="ghost" size="sm" onClick={onLoadMore} disabled={isLoadingMore}>
                {isLoadingMore && <Loader2 className="animate-spin" />}
                Load more
              </Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

function PinnedRowItem({
  row,
  selfTalkUserId,
  onUnpin,
  onJump,
}: {
  row: PinnedRow
  selfTalkUserId: Id | null
  onUnpin: (messageId: Id, forEveryone: boolean) => void
  onJump: (messageId: Id) => void
}) {
  const mediaUrl = useMediaUrl()
  const { pin, message } = row

  // The author of the MESSAGE, not whoever pinned it — that is what the reader
  // is looking for when scanning a list of pins.
  const isMine = message.senderTalkUserId === selfTalkUserId
  const isPrivate = !pin.forEveryone
  const author =
    message.senderTalkUserId === null
      ? null
      : resolveTalkUser(message.senderTalkUserId, message.senderName, message.senderPhoto)

  return (
    // The row is a button: a list of pins is only useful if it can put one back
    // in its conversation, which is what a reader clicking one means. Unpin sits
    // outside it, so the destructive action is never the one a stray click hits.
    <div className="group relative flex items-start gap-3 px-4 py-2.5 hover:bg-accent/50">
      <button
        type="button"
        onClick={() => onJump(message.id)}
        aria-label="Go to this message"
        className="absolute inset-0 cursor-pointer"
      />
      <Avatar
        name={author?.name ?? 'System'}
        src={mediaUrl(author?.avatarKey ?? null) || undefined}
        className="relative size-8 shrink-0"
      />

      <div className="pointer-events-none relative min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium text-primary">
            {isMine ? 'You' : (author?.name ?? 'System')}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            {/* Said on the row, not left to the icon: the whole difference
                between the two pins is who else can see it. */}
            {isPrivate && (
              <span className="rounded-full bg-secondary px-1.5 py-px text-[10px] font-medium text-muted-foreground">
                Only you
              </span>
            )}
            {/* When it was PINNED — the list is ordered by that, so any other
                date here would read as a broken sort. */}
            <span className="text-[11px] text-muted-foreground">
              {formatChatTime(pin.pinnedAt)}
            </span>
          </span>
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {pinPreview(message, selfTalkUserId)}
        </p>
      </div>

      <Tip label={isPrivate ? 'Unpin for me' : 'Unpin for everyone'}>
        <button
          type="button"
          onClick={() => onUnpin(message.id, pin.forEveryone)}
          aria-label={isPrivate ? 'Unpin this for me' : 'Unpin this for everyone'}
          className="relative shrink-0 cursor-pointer rounded-md p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-foreground"
        >
          {/* One glyph for both scopes — the ACTION is the same unpin either
              way, and the tooltip plus the "Only you" badge already say which
              audience the row belongs to. */}
          <PinOff className="size-4" />
        </button>
      </Tip>
    </div>
  )
}

/** One line for a pinned message, whatever kind it is. */
function pinPreview(message: ChatMessage, selfTalkUserId: Id | null): string {
  if (message.isDeletedForEveryone) return DELETED_MESSAGE_TEXT
  if (message.type === 'system') return systemMessageText(message, selfTalkUserId)
  const text = message.body?.trim()
  if (text) return text
  const first = message.media[0]
  return first ? mediaLabel(first) : 'Pinned message'
}
