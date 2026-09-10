import { ArrowLeft, Ban, Info, LogOut, MoreVertical, Pin, Search, Trash2, Users } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { OnlineBadge } from '@/components/common/online-badge'
import { Tip } from '@/components/common/tip'
import { useMediaUrl } from '@/hooks/use-app-config'
import { useChatStore } from '@/stores/chat-store'
import { useUiStore } from '@/stores/ui-store'
import { cn } from '@/lib/utils'
import { keyOf } from '@/types/api'
import {
  canHideChat,
  chatLabel,
  leaveGroupCopy,
  memberCountLine,
  removeChatCopy,
} from '../lib/chat-labels'
import { canEditGroup } from '../lib/member-roles'
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
  const confirm = useChatHeaderActions(chat)

  // Disbanding stays OWNER-ONLY — it is one of the two powers an admin does not
  // inherit — while leaving is now open to everybody, the creator included.
  const canDisband = canEditGroup(chat.self)
  const canLeave = !chat.self.hasLeft
  // Hiding the row is a DIRECT chat's ending, and a left group's second one —
  // leaving freezes the row on the list, and this is what gets rid of it.
  const canRemove = canHideChat(chat)
  // Nothing to end means no separator with nothing under it.
  const hasEndingAction = canRemove || canDisband || canLeave
  const counterpartId = chat.counterpartTalkUserId
  const isBlockedByMe = counterpartId !== null && blockedIds.includes(counterpartId)

  // Typing beats presence: it is newer information and says more.
  const subtitle =
    typingNames.length > 0
      ? formatTypingLine(typingNames, chat.type === 'direct')
      : chat.type === 'group'
        ? // Frozen at the moment I left, name and picture included — so the
          // line says WHEN, rather than reporting a stale count as today's.
          memberCountLine(chat.memberCount, chat.self.hasLeft)
        : formatLastSeen(presence)

  return (
    <header className="flex shrink-0 items-center gap-1 border-b border-border bg-card px-2 py-2">
      <Tip label="Back to conversations">
        <Button
          variant="ghost"
          size="icon"
          className="size-8 md:hidden"
          onClick={() => setSidebarOpen(true)}
          aria-label="Back to conversations"
        >
          <ArrowLeft />
        </Button>
      </Tip>

      {/* Sized to its CONTENT, not to the bar. Stretching it meant the hover
          highlight — and the hit area for "open details" — ran the whole width
          of the header, so a click on empty space beside the name opened the
          sheet. It still SHRINKS below its content when the bar is tight, which
          is what keeps the name truncating instead of shoving the toolbar. */}
      <button
        type="button"
        onClick={onOpenDetails}
        className="flex min-w-0 cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1 text-left"
      >
        {/* Presence sits on the picture here too, not only in the list — the
            "Online" word below it is the detail, and the dot is what you see. */}
        <span className="relative shrink-0">
          <Avatar
            name={label.title}
            src={mediaUrl(label.avatarKey) || undefined}
            className="size-9"
          />
          {chat.type === 'direct' && presence?.isOnline && (
            <OnlineBadge online className="absolute -right-0.5 bottom-0" />
          )}
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-1">
            {/* The conversation's name is the loudest thing in the bar, so the
                actions beside it can afford to be quiet. */}
            <span className="truncate text-sm font-semibold tracking-[-0.01em]">
              {label.title}
            </span>
            {chat.type === 'group' && (
              <Users className="size-3 shrink-0 text-muted-foreground" aria-hidden />
            )}
          </span>
          <span
            className={cn(
              'block truncate text-[11px]',
              typingNames.length > 0 ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            {subtitle}
          </span>
        </span>
      </button>

      {/* The gap the button no longer eats, so the toolbar still sits right. */}
      <span className="min-w-0 flex-1" aria-hidden />

      {/* Five equal icon buttons read as a toolbar and made the name compete
          with them. Only the two REACHING actions stay on the bar — find, and
          the chat's pins — and everything that changes or ends the conversation
          moves behind one overflow menu, where a destructive item can be
          labelled in words instead of guessed from a glyph. */}
      <Tip label={isSearchOpen ? 'Close search (Esc)' : 'Search this conversation (Ctrl+F)'}>
        <Button
          variant="ghost"
          size="icon"
          className={cn('size-8', isSearchOpen && 'bg-accent text-accent-foreground')}
          onClick={onOpenSearch}
          aria-label={isSearchOpen ? 'Close search' : 'Search this conversation'}
          aria-expanded={isSearchOpen}
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
          className="relative size-8"
        >
          <Pin />
          {pinCount > 0 && (
            <span
              aria-hidden
              className="absolute top-0 right-0 flex size-3.5 items-center justify-center rounded-full bg-primary-fill text-[9px] font-semibold text-primary-fill-foreground"
            >
              {pinCount > 9 ? '9+' : pinCount}
            </span>
          )}
        </Button>
      </Tip>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 data-[state=open]:bg-accent data-[state=open]:text-accent-foreground"
            aria-label="Conversation actions"
          >
            <MoreVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {/* Named after the sheet it opens, which titles itself by the KIND of
              conversation — "Conversation details" matched neither. */}
          <DropdownMenuItem onSelect={onOpenDetails}>
            <Info />
            {chat.type === 'group' ? 'Group info' : 'Contact info'}
          </DropdownMenuItem>

          {chat.type === 'direct' && counterpartId !== null && (
            <DropdownMenuItem
              className="items-start"
              onSelect={() => block.ask(counterpartId, label.title, !isBlockedByMe)}
            >
              <Ban className="mt-0.5" />
              {/* The block being silent is the one thing a reader needs BEFORE
                  they commit, so it stays in the menu — but as its own hint
                  line. Hung off the label with an em-dash it wrapped mid-phrase
                  and read as a two-line label rather than a fact about the
                  action. */}
              <span className="flex flex-col gap-0.5">
                {isBlockedByMe ? 'Unblock this person' : 'Block this person'}
                <span className="text-[11px] leading-tight text-muted-foreground">
                  {isBlockedByMe
                    ? 'Messages sent while blocked stay hidden'
                    : 'They are never told'}
                </span>
              </span>
            </DropdownMenuItem>
          )}

          {hasEndingAction && <DropdownMenuSeparator />}

          {chat.type === 'group' ? (
            // Both, for the creator — they are different acts now, not one
            // instead of the other. Leaving hands the group to somebody else and
            // keeps it alive; disbanding takes the conversation away from every
            // member, which is why it is labelled as a deletion and is the only
            // one of the two an admin does not inherit.
            <>
              {canLeave && (
                <DropdownMenuItem variant="destructive" onSelect={() => confirm.ask('leave')}>
                  <LogOut />
                  Leave group
                </DropdownMenuItem>
              )}
              {/* Only once you are OUT. Until then the server refuses it, and
                  the row is still a live conversation to you anyway. */}
              {canRemove && (
                <DropdownMenuItem variant="destructive" onSelect={() => confirm.ask('remove')}>
                  <Trash2 />
                  Remove from your list
                </DropdownMenuItem>
              )}
              {canDisband && (
                <DropdownMenuItem variant="destructive" onSelect={() => confirm.ask('disband')}>
                  <Trash2 />
                  Delete for everyone
                </DropdownMenuItem>
              )}
            </>
          ) : (
            <DropdownMenuItem variant="destructive" onSelect={() => confirm.ask('remove')}>
              <Trash2 />
              Remove from your list
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {confirm.confirmKind !== null && (
        <ConfirmDialog
          {...(confirm.confirmKind === 'disband'
            ? {
                title: 'Delete this group for everyone?',
                message: `${label.title} and its messages go away for every member. This cannot be undone.`,
                confirmLabel: 'Delete for everyone',
              }
            : confirm.confirmKind === 'leave'
              ? // The creator's leave hands the group ON, which is neither
                // obvious nor reversible — so the copy names the heir, resolved
                // by the same rule the server uses.
                leaveGroupCopy(label.title, canDisband, confirm.successorName)
              : removeChatCopy(label.title, chat.type === 'group'))}
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
