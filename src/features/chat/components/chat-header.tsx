import { ArrowLeft, Ban, Info, LogOut, Pin, Search, Trash2, Users } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { Tip } from '@/components/common/tip'
import { useMediaUrl } from '@/hooks/use-app-config'
import { useChatStore } from '@/stores/chat-store'
import { useUiStore } from '@/stores/ui-store'
import { cn } from '@/lib/utils'
import { keyOf } from '@/types/api'
import { chatLabel } from '../lib/chat-labels'
import { formatLastSeen, formatTypingLine } from '../lib/message-formatters'
import { useChatHeaderActions } from '../hooks/use-chat-header-actions'
import { usePersonBlock } from '../hooks/use-person-block'
import { PersonBlockDialog } from './person-block-dialog'
import { useTypingNames } from '../hooks/use-typing'
import type { Chat } from '../types'

interface ChatHeaderProps {
  chat: Chat
  onOpenDetails: () => void
  /** Toggles the find bar — the same button closes it again. */
  onOpenSearch: () => void
  isSearchOpen: boolean
  /** Opens the pinned-messages sheet. */
  onOpenPins: () => void
  /** The server's pin count, for the badge on the button. */
  pinCount: number
}

export function ChatHeader({
  chat,
  onOpenDetails,
  onOpenSearch,
  isSearchOpen,
  onOpenPins,
  pinCount,
}: ChatHeaderProps) {
  const mediaUrl = useMediaUrl()
  const label = chatLabel(chat)
  const typingNames = useTypingNames(chat.id)
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen)
  const blockedIds = useChatStore((s) => s.blockedTalkUserIds)
  const presence = useChatStore((s) =>
    chat.counterpartTalkUserId === null
      ? undefined
      : s.presence[keyOf(chat.counterpartTalkUserId)],
  )
  const block = usePersonBlock()
  const confirm = useChatHeaderActions(chat.id)

  const isOwner = chat.self.memberRole === 'owner'
  const counterpartId = chat.counterpartTalkUserId
  const isBlockedByMe = counterpartId !== null && blockedIds.includes(counterpartId)

  // Typing beats presence: it is newer information and says more.
  const subtitle =
    typingNames.length > 0
      ? formatTypingLine(typingNames)
      : chat.type === 'group'
        ? `${chat.memberCount} ${chat.memberCount === 1 ? 'member' : 'members'}`
        : formatLastSeen(presence)

  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-2.5">
      <Tip label="Back to conversations">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={() => setSidebarOpen(true)}
          aria-label="Back to conversations"
        >
          <ArrowLeft />
        </Button>
      </Tip>

      <button
        type="button"
        onClick={onOpenDetails}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-1 py-0.5 text-left"
      >
        <Avatar
          name={label.title}
          src={mediaUrl(label.avatarKey) || undefined}
          className="size-8"
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1">
            <span className="truncate text-sm font-medium">{label.title}</span>
            {chat.type === 'group' && (
              <Users className="size-3 shrink-0 text-muted-foreground" aria-hidden />
            )}
          </span>
          <span
            className={cn(
              'block truncate text-xs',
              typingNames.length > 0 ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            {subtitle}
          </span>
        </span>
      </button>

      <Tip label={isSearchOpen ? 'Close search' : 'Search this conversation'}>
        <Button
          variant="ghost"
          size="icon"
          onClick={onOpenSearch}
          aria-label={isSearchOpen ? 'Close search' : 'Search this conversation'}
          aria-expanded={isSearchOpen}
          className={cn(isSearchOpen && 'bg-accent text-accent-foreground')}
        >
          <Search />
        </Button>
      </Tip>

      {/* THE OTHER PIN. This opens the messages pinned for everyone in the chat;
          pinning the CONVERSATION to my own list is private to me and lives in
          the sidebar row's right-click menu, where it cannot be mistaken for
          this one. */}
      <Tip label="Pinned messages">
        <Button
          variant="ghost"
          size="icon"
          onClick={onOpenPins}
          aria-label={
            pinCount > 0 ? `Pinned messages (${pinCount})` : 'Pinned messages'
          }
          className="relative"
        >
          <Pin />
          {pinCount > 0 && (
            <span
              aria-hidden
              className="absolute top-0.5 right-0.5 flex size-3.5 items-center justify-center rounded-full bg-primary text-[9px] font-semibold text-primary-foreground"
            >
              {pinCount > 9 ? '9+' : pinCount}
            </span>
          )}
        </Button>
      </Tip>

      {chat.type === 'direct' && counterpartId !== null && (
        <Tip label={isBlockedByMe ? 'Unblock' : 'Block — they are never told'}>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => block.ask(counterpartId, label.title, !isBlockedByMe)}
            aria-label={isBlockedByMe ? 'Unblock this person' : 'Block this person'}
          >
            <Ban className={isBlockedByMe ? 'text-destructive' : undefined} />
          </Button>
        </Tip>
      )}

      {chat.type === 'group' ? (
        // The owner cannot leave a group — they disband it, which takes the
        // conversation away from every member, so it is labelled as a deletion.
        isOwner ? (
          <Tip label="Delete for everyone">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => confirm.ask('disband')}
              aria-label="Delete this group for everyone"
            >
              <Trash2 />
            </Button>
          </Tip>
        ) : (
          !chat.self.hasLeft && (
            <Tip label="Leave group">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => confirm.ask('leave')}
                aria-label="Leave this group"
              >
                <LogOut />
              </Button>
            </Tip>
          )
        )
      ) : (
        <Tip label="Remove from your list">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => confirm.ask('remove')}
            aria-label="Remove this conversation from your list"
          >
            <Trash2 />
          </Button>
        </Tip>
      )}

      <Tip label="Conversation details">
        <Button
          variant="ghost"
          size="icon"
          onClick={onOpenDetails}
          aria-label="Conversation details"
        >
          <Info />
        </Button>
      </Tip>
      {confirm.confirmKind !== null && (
        <ConfirmDialog
          title={
            confirm.confirmKind === 'disband'
              ? 'Delete this group for everyone?'
              : confirm.confirmKind === 'leave'
                ? 'Leave this group?'
                : 'Remove this conversation?'
          }
          message={
            confirm.confirmKind === 'disband'
              ? `${label.title} and its messages go away for every member. This cannot be undone.`
              : confirm.confirmKind === 'leave'
                ? `You stop receiving messages in ${label.title}. The history stays readable, and an owner can add you back.`
                : `${label.title} leaves your list and its messages are hidden from you. The conversation comes back if they message you again.`
          }
          confirmLabel={
            confirm.confirmKind === 'disband'
              ? 'Delete for everyone'
              : confirm.confirmKind === 'leave'
                ? 'Leave'
                : 'Remove'
          }
          tone="destructive"
          isPending={confirm.isPending}
          onConfirm={() => void confirm.run()}
          onCancel={confirm.cancel}
        />
      )}
      <PersonBlockDialog block={block} />
    </header>
  )
}
