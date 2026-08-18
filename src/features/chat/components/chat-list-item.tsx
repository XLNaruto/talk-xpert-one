import { Check, CheckCheck, Pin, Users } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { OnlineBadge } from '@/components/common/online-badge'
import { useMediaUrl } from '@/hooks/use-app-config'
import { useChatStore } from '@/stores/chat-store'
import { cn } from '@/lib/utils'
import { keyOf, type Id } from '@/types/api'
import { chatLabel, previewLine } from '../lib/chat-labels'
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
}

export function ChatListItem({
  chat,
  isActive,
  selfTalkUserId,
  isSelected,
  onSelect,
  onToggleSelected,
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

  const isMyLastMessage =
    chat.lastMessageSenderTalkUserId !== null &&
    chat.lastMessageSenderTalkUserId === selfTalkUserId

  return (
    <button
      type="button"
      onClick={() => (selecting ? onToggleSelected(chat.id) : onSelect(chat.id))}
      aria-current={isActive}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
        isActive && 'bg-sidebar-accent text-sidebar-accent-foreground',
        isSelected && 'ring-1 ring-primary',
      )}
    >
      <span className="relative shrink-0">
        <Avatar name={label.title} src={mediaUrl(label.avatarKey) || undefined} />
        {chat.type === 'group' ? (
          <span className="absolute -right-1 -bottom-1 rounded-full bg-sidebar p-0.5">
            <Users className="size-3 text-muted-foreground" />
          </span>
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
            <span className="truncate text-sm font-medium">{label.title}</span>
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
  )
}
