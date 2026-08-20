import { Check, CheckCheck, Pin, PinOff, SquareCheck, Trash2, Users } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { OnlineBadge } from '@/components/common/online-badge'
import { useMediaUrl } from '@/hooks/use-app-config'
import { useChatStore } from '@/stores/chat-store'
import { cn } from '@/lib/utils'
import { keyOf, type Id } from '@/types/api'
import { chatLabel, previewLine } from '../lib/chat-labels'
import { resolveTalkUser } from '../lib/talk-directory'
import { formatChatTime, formatTypingLine } from '../lib/message-formatters'
import { useTypingNames } from '../hooks/use-typing'
import type { Chat } from '../types'

/**
 * Sent / read ticks.
 *
 * The row only ever knows "sent": `is_read_by_all` lives on a message, not on a
 * chat row, so the blue tick is the thread's job and the list shows the single
 * one. Both states are here so the two screens read the same.
 */
function ReadTick({ read }: { read: boolean }) {
  return read ? (
    <CheckCheck className="size-3 shrink-0 text-info" aria-label="Read" />
  ) : (
    <Check className="size-3 shrink-0" aria-label="Sent" />
  )
}

interface ChatListItemProps {
  chat: Chat
  isActive: boolean
  selfTalkUserId: Id | null
  /** Non-null while a bulk selection is in progress. */
  isSelected: boolean | null
  onSelect: (chatId: Id) => void
  onToggleSelected: (chatId: Id) => void
  onPin: (chatId: Id, pinned: boolean) => void
  onMarkRead: (chatId: Id) => void
  onDelete: (chatId: Id) => void
}

export function ChatListItem({
  chat,
  isActive,
  selfTalkUserId,
  isSelected,
  onSelect,
  onToggleSelected,
  onPin,
  onMarkRead,
  onDelete,
}: ChatListItemProps) {
  const mediaUrl = useMediaUrl()
  const label = chatLabel(chat)
  const typingNames = useTypingNames(chat.id)
  const presence = useChatStore((s) =>
    chat.counterpartTalkUserId === null
      ? undefined
      : s.presence[keyOf(chat.counterpartTalkUserId)],
  )

  const selecting = isSelected !== null
  // Someone typing is more useful than the last message, so it wins the line.
  const secondLine =
    typingNames.length > 0
      ? formatTypingLine(typingNames)
      : previewLine(chat, selfTalkUserId)

  // The last sender is drawn from the row itself — `last_message_sender_name`
  // and `_photo` ride along with the chat, so the corner costs no second read.
  const groupCorner =
    chat.type === 'group' && chat.lastMessageSenderTalkUserId !== null
      ? resolveTalkUser(
          chat.lastMessageSenderTalkUserId,
          chat.lastMessageSenderName,
          chat.lastMessageSenderPhoto,
        )
      : null

  const isMyLastMessage =
    chat.lastMessageSenderTalkUserId !== null &&
    chat.lastMessageSenderTalkUserId === selfTalkUserId

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={selecting}>
    <button
      type="button"
      onClick={() => (selecting ? onToggleSelected(chat.id) : onSelect(chat.id))}
      aria-current={isActive}
      aria-pressed={isSelected ?? undefined}
      className={cn(
        'relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
        'hover:bg-sidebar-accent/50',
        // The active row is brand paint, not the neutral accent — the accent sat
        // a shade away from the avatar fill and the two washed each other out.
        // The inset bar down the leading edge is what carries "this one" at a
        // glance, so the row still reads as active on a tinted or busy list.
        isActive &&
          'bg-primary/12 text-sidebar-accent-foreground shadow-[inset_3px_0_0_0_var(--primary)] hover:bg-primary/12',
        // Selection is carried by the tick on the avatar, the way WhatsApp does
        // it — the row only tints. A ring around every picked row fights the
        // active row's own highlight and turns the list into a stack of boxes.
        isSelected && 'bg-primary/10',
      )}
    >
      <span className="relative shrink-0">
        <Avatar
          name={label.title}
          src={mediaUrl(label.avatarKey) || undefined}
          className={cn(isSelected && 'opacity-80')}
        />
        {/* While a selection is running the corner is the tick's, so presence
            and the group glyph step aside rather than stack under it. */}
        {isSelected ? (
          <span className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full border-2 border-sidebar bg-primary">
            <Check className="size-2.5 text-primary-foreground" strokeWidth={3} />
          </span>
        ) : chat.type === 'group' ? (
          // A group's corner names WHO SPOKE LAST — the row already reads as a
          // group from its own picture, so the glyph was spending the only spot
          // that could carry new information. It falls back to the glyph when
          // the last row has no sender (a system event, or an empty group).
          groupCorner ? (
            <Avatar
              name={groupCorner.name}
              src={mediaUrl(groupCorner.avatarKey) || undefined}
              className="absolute -right-1 -bottom-1 size-4 border-2 border-sidebar text-[7px] ring-0"
            />
          ) : (
            <span className="absolute -right-1 -bottom-1 rounded-full bg-sidebar p-0.5">
              <Users className="size-3 text-muted-foreground" />
            </span>
          )
        ) : (
          <OnlineBadge
            online={presence?.isOnline ?? false}
            className="absolute -right-0.5 bottom-0"
          />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1">
            {chat.self.isPinned && (
              <Pin
                className="size-3 shrink-0 text-muted-foreground"
                aria-label="Pinned"
              />
            )}
            <span className={cn('truncate text-sm', isActive ? 'font-semibold' : 'font-medium')}>
              {label.title}
            </span>
          </span>
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {formatChatTime(chat.lastMessageAt)}
          </span>
        </span>

        <span className="mt-0.5 flex items-center justify-between gap-2">
          <span
            className={cn(
              'flex min-w-0 items-center gap-1 text-xs',
              typingNames.length > 0 ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            {/* Ticks belong on my own last message only — read state is the
                sender's information, so a row I did not write shows none. */}
            {isMyLastMessage && typingNames.length === 0 && <ReadTick read={false} />}
            <span className="truncate">{secondLine}</span>
          </span>

          {chat.unreadCount > 0 && (
            <span
              className="shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground"
              aria-label={`${chat.unreadCount} unread`}
            >
              {chat.unreadCount > 99 ? '99+' : chat.unreadCount}
            </span>
          )}
        </span>
      </span>
    </button>
      </ContextMenuTrigger>

      {/* Radix anchors this to the pointer, so it opens on the row that was
          clicked and flips itself away from the sidebar's edges. */}
      <ContextMenuContent className="w-44">
        <ContextMenuItem onSelect={() => onPin(chat.id, !chat.self.isPinned)}>
          {chat.self.isPinned ? <PinOff /> : <Pin />}
          {chat.self.isPinned ? 'Unpin' : 'Pin'}
        </ContextMenuItem>
        {chat.unreadCount > 0 && (
          <ContextMenuItem onSelect={() => onMarkRead(chat.id)}>
            <CheckCheck />
            Mark as read
          </ContextMenuItem>
        )}
        <ContextMenuItem onSelect={() => onToggleSelected(chat.id)}>
          <SquareCheck />
          Select
        </ContextMenuItem>
        {/* Deleting is hiding, and only a DIRECT chat can be hidden — the API
            refuses a group with a 400, so a group is offered "Leave" in its
            details sheet instead of an action that cannot work here. */}
        {chat.type === 'direct' && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onSelect={() => onDelete(chat.id)}>
              <Trash2 />
              Delete
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
