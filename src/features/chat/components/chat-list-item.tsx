import { useEffect, useRef } from 'react'
import { Check, CheckCheck, LogOut, Pin, PinOff, SquareCheck, Trash2, Users } from 'lucide-react'
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
import { canHideChat, chatLabel, previewLine } from '../lib/chat-labels'
import { canEditGroup } from '../lib/member-roles'
import { resolveTalkUser } from '../lib/talk-directory'
import { formatChatTime, formatTypingLine } from '../lib/message-formatters'
import { useTypingNames } from '../hooks/use-typing'
import type { Chat } from '../types'

/**
 * Sent / read ticks — the same pair the bubble draws, so the two screens agree.
 *
 * `is_read_by_all` lives on a MESSAGE and not on a chat row, so the blue tick
 * comes off the cached message the row is quoting (`lastMessageReadByAll`),
 * which `talk.message.read` keeps current. A chat this device has not opened
 * this session has no cached message to ask, and shows the single tick.
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
  /** Highlighted by the sidebar search field's arrow keys. */
  isCursor?: boolean
  onSelect: (chatId: Id) => void
  onToggleSelected: (chatId: Id) => void
  onPin: (chatId: Id, pinned: boolean) => void
  onMarkRead: (chatId: Id) => void
  onDelete: (chatId: Id) => void
  /** Group only — both ask before they run, in the sidebar's own dialog. */
  onLeaveGroup: (chat: Chat) => void
  onDisbandGroup: (chat: Chat) => void
}

export function ChatListItem({
  chat,
  isActive,
  selfTalkUserId,
  isSelected,
  isCursor = false,
  onSelect,
  onToggleSelected,
  onPin,
  onMarkRead,
  onDelete,
  onLeaveGroup,
  onDisbandGroup,
}: ChatListItemProps) {
  const mediaUrl = useMediaUrl()
  const ref = useRef<HTMLButtonElement>(null)
  const label = chatLabel(chat)

  // Focus stays in the search field while the arrows run, so the row has to
  // bring ITSELF into view once the cursor walks past the fold.
  useEffect(() => {
    if (isCursor) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [isCursor])
  const typingNames = useTypingNames(chat.id)
  const presence = useChatStore((s) =>
    chat.counterpartTalkUserId === null
      ? undefined
      : s.presence[keyOf(chat.counterpartTalkUserId)],
  )

  const selecting = isSelected !== null
  // Is there anything at the foot of the menu at all — see the note there.
  const endingActions =
    canHideChat(chat) || !chat.self.hasLeft || canEditGroup(chat.self.memberRole)
  // Someone typing is more useful than the last message, so it wins the line.
  const secondLine =
    typingNames.length > 0
      ? formatTypingLine(typingNames, chat.type === 'direct')
      : previewLine(chat, selfTalkUserId)

  // The last sender is drawn from the row itself — `last_message_sender_name`
  // and `_photo` ride along with the chat, so the corner costs no second read.
  //
  // A SYSTEM event ("Minato added Goku") has no sender at all, so it falls back
  // to whoever ACTED, which the stream copies off `system_data` as the event
  // lands. That leaves one gap the API cannot close: a system event this device
  // only ever saw through a list read carries no operands, and keeps the glyph.
  const cornerPerson =
    chat.lastMessageSenderTalkUserId !== null
      ? {
          id: chat.lastMessageSenderTalkUserId,
          name: chat.lastMessageSenderName,
          photo: chat.lastMessageSenderPhoto,
        }
      : chat.lastMessageActor
        ? {
            id: chat.lastMessageActor.talkUserId,
            name: chat.lastMessageActor.name,
            photo: chat.lastMessageActor.photo,
          }
        : null

  const groupCorner =
    chat.type === 'group' && cornerPerson
      ? resolveTalkUser(cornerPerson.id, cornerPerson.name, cornerPerson.photo)
      : null

  const isMyLastMessage =
    chat.lastMessageSenderTalkUserId !== null &&
    chat.lastMessageSenderTalkUserId === selfTalkUserId

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={selecting}>
    <button
      ref={ref}
      type="button"
      onClick={() => (selecting ? onToggleSelected(chat.id) : onSelect(chat.id))}
      aria-current={isActive}
      aria-pressed={isSelected ?? undefined}
      className={cn(
        'relative flex w-full items-center gap-3 overflow-hidden rounded-lg px-3 py-2.5 text-left',
        // Colour AND the press, so a tap answers on the way down rather than
        // only once the thread has swapped.
        'transition-[background-color,transform] duration-150 active:scale-[0.995]',
        // Separation is the hover tint and the gap between rows — NO hairline.
        // A line under every row turned the list into a table of boxes, and it
        // cut across the active row's own paint.
        'hover:bg-sidebar-accent/60',
        // The active row is brand paint, not the neutral accent — the accent sat
        // a shade away from the avatar fill and the two washed each other out.
        // `chat-row-active` (globals.css) draws it: a light brand wash, the
        // leading edge bar with a highlight travelling down it, and one slow
        // sheen across the row. The bar is what carries "this one" at a glance;
        // the motion says the thread is the open one. The wash stays light
        // enough that the row keeps the sidebar's own text colour — only the
        // preview line steps up from muted grey, which dulls against blue.
        isActive && 'chat-row-active text-sidebar-accent-foreground hover:bg-transparent',
        // Selection is carried by the tick on the avatar, the way WhatsApp does
        // it — the row only tints. A ring around every picked row fights the
        // active row's own highlight and turns the list into a stack of boxes.
        isSelected && 'bg-primary/10',
        // The keyboard's highlight — a ring, so it reads on top of the active
        // row's own paint instead of being swallowed by it.
        isCursor && 'bg-sidebar-accent ring-2 ring-primary ring-inset',
      )}
    >
      <span className="relative shrink-0">
        <Avatar
          name={label.title}
          src={mediaUrl(label.avatarKey) || undefined}
          className={cn(
            isSelected && 'opacity-80',
            // A halo the tint alone can't give — the picture is the row's
            // anchor, so the active state should reach it too.
            isActive && 'ring-2 ring-primary/45',
          )}
        />
        {/* While a selection is running the corner is the tick's, so presence
            and the group glyph step aside rather than stack under it. */}
        {isSelected ? (
          <span className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full border-2 border-sidebar bg-primary-fill">
            <Check className="size-2.5 text-primary-fill-foreground" strokeWidth={3} />
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
          {/* Three weights, and each one means something: the OPEN thread and
              anything UNREAD are semibold, everything else is normal. Making
              every row medium flattened the list into one texture, so nothing
              stood out from it. The negative tracking is what keeps a semibold
              name from looking wider than its neighbours. */}
          <span
            className={cn(
              'min-w-0 truncate text-sm tracking-[-0.01em]',
              isActive || chat.unreadCount > 0 ? 'font-semibold' : 'font-normal',
            )}
          >
            {label.title}
          </span>
          {/* The pin rides with the timestamp rather than the name: it is a
              property of the ROW's placement in the list, and a long name no
              longer pushes it off the line. */}
          <span
            className={cn(
              'flex shrink-0 items-center gap-1 text-[11px]',
              // The time steps up with the row: on an unread row it is part of
              // "something happened here", not chrome.
              chat.unreadCount > 0
                ? 'font-medium text-foreground/70'
                : 'text-muted-foreground',
            )}
          >
            {chat.self.isPinned && (
              <Pin className="size-3 shrink-0" aria-label="Pinned" />
            )}
            {formatChatTime(chat.lastMessageAt)}
          </span>
        </span>

        <span className="mt-0.5 flex items-center justify-between gap-2">
          <span
            className={cn(
              'flex min-w-0 items-center gap-1 text-xs',
              typingNames.length > 0
                ? 'text-primary'
                : isActive
                  ? 'text-sidebar-accent-foreground/85'
                  : chat.unreadCount > 0
                    // Unread copy is the message you have not read yet, so it
                    // sits at reading contrast rather than at chrome grey.
                    ? 'font-medium text-foreground/80'
                    : 'text-muted-foreground',
            )}
          >
            {/* Ticks belong on my own last message only — read state is the
                sender's information, so a row I did not write shows none. */}
            {isMyLastMessage && typingNames.length === 0 && (
              <ReadTick read={chat.lastMessageReadByAll} />
            )}
            <span className="truncate">{secondLine}</span>
          </span>

          {chat.unreadCount > 0 && (
            <span
              className="shrink-0 rounded-full bg-primary-fill px-1.5 py-0.5 text-[10px] font-semibold text-primary-fill-foreground"
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
        {/* Deleting is HIDING — it takes the row off MY list only. A direct chat
            can always be hidden; a GROUP only once I have left it, which is the
            server's own rule (`canHideChat`) and why leaving comes first and the
            two sit next to each other. Disbanding is a third, different act:
            it takes the conversation away from every member, so only the creator
            is offered it. All three are the same questions the thread header
            asks, so a row need not be opened to answer them, and the rule above
            them is drawn only when at least one of them is. */}
        {endingActions && <ContextMenuSeparator />}
        {/* A group already left keeps its history and its row, so there is
            nothing more to leave — only to get rid of. */}
        {chat.type === 'group' && !chat.self.hasLeft && (
          <ContextMenuItem variant="destructive" onSelect={() => onLeaveGroup(chat)}>
            <LogOut />
            Leave group
          </ContextMenuItem>
        )}
        {canHideChat(chat) && (
          <ContextMenuItem variant="destructive" onSelect={() => onDelete(chat.id)}>
            <Trash2 />
            Delete
          </ContextMenuItem>
        )}
        {chat.type === 'group' && canEditGroup(chat.self.memberRole) && (
          <ContextMenuItem variant="destructive" onSelect={() => onDisbandGroup(chat)}>
            <Trash2 />
            Delete for everyone
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
