import { useState } from 'react'
import { CheckCheck, Search, Trash2, UserRoundPlus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { BrandLogo } from '@/components/common/brand-logo'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { Tip } from '@/components/common/tip'
import { useAuthStore } from '@/stores/auth-store'
import { cn } from '@/lib/utils'
import { useChatList, type ChatFilter } from '../hooks/use-chat-list'
import { chatCursorKey, contactCursorKey } from '../hooks/use-search-cursor'
import { chatLabel, leaveGroupCopy, removeChatCopy } from '../lib/chat-labels'
import { canEditGroup } from '../lib/member-roles'
import { formatBadge, tabUnreadCount } from '../lib/unread-badges'
import type { Chat } from '../types'
import { ChatListItem } from './chat-list-item'
import { ChatSection } from './chat-section'
import { ContactRow } from './contact-row'
import { SidebarEmpty } from './sidebar-empty'
import { SidebarSkeleton } from './sidebar-skeleton'
import { CreateGroupDialog } from './create-group-dialog'
import { SidebarAccountBar } from './sidebar-account-bar'

const FILTERS: Array<{ value: ChatFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
  { value: 'direct', label: 'Direct' },
  { value: 'group', label: 'Groups' },
]

/**
 * The conversation list. All state comes from `useChatList`, which is mounted
 * here and only here — it owns the list read.
 */
export function ChatSidebar() {
  const {
    chats,
    isLoading,
    search,
    setSearch,
    isSearchOpen,
    toggleSearch,
    closeSearch,
    filter,
    setFilter,
    unreadSummary,
    activeChatId,
    selectChat,
    setChatPinned,
    markChatRead,
    selectedIds,
    selectedRemovableIds,
    toggleSelected,
    clearSelection,
    deleteSelected,
    markAllRead,
    hasSelection,
    contacts,
    isDirectoryLoading,
    openContact,
    isOpeningContact,
    cursorKey,
    onSearchKeyDown,
    rowConfirm,
  } = useChatList()

  const selfTalkUserId = useAuthStore((s) => s.identity?.talkUserId ?? null)
  const [isCreatingGroup, setCreatingGroup] = useState(false)
  // Purely visual, and deliberately NOT persisted: a fold is a glance at a long
  // list, not a preference to carry across reloads.
  const [folded, setFolded] = useState({ pinned: false, recent: false })
  const toggleFold = (key: 'pinned' | 'recent') =>
    setFolded((prev) => ({ ...prev, [key]: !prev[key] }))

  // Two runs, one boundary: kept conversations, then everything else. Only
  // outside a search — see the note at the call site.
  const pinnedChats = chats.filter((chat) => chat.self.isPinned)
  const recentChats = chats.filter((chat) => !chat.self.isPinned)

  const chatRow = (chat: Chat) => (
    <ChatListItem
      key={chat.id}
      chat={chat}
      isActive={chat.id === activeChatId}
      selfTalkUserId={selfTalkUserId}
      isSelected={hasSelection ? selectedIds.includes(chat.id) : null}
      isCursor={cursorKey === chatCursorKey(chat.id)}
      onSelect={selectChat}
      onToggleSelected={toggleSelected}
      onPin={setChatPinned}
      onMarkRead={markChatRead}
      onDelete={() => rowConfirm.ask('remove', chat)}
      onLeaveGroup={(target) => rowConfirm.ask('leave', target)}
      onDisbandGroup={(target) => rowConfirm.ask('disband', target)}
    />
  )

  return (
    // `relative` so the account card can float over the list — see the note on
    // its own wrapper.
    <aside className="relative flex h-full w-full flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:w-80 md:border-r-0">
      <div className="shrink-0 space-y-3 p-3">
        <div className="flex items-center justify-between gap-2">
          <BrandLogo />
          <div className="flex items-center gap-1">
            {/* These moved up from the foot of the list when the profile row
                took that space — they act on the whole list, so they belong
                beside "New group" rather than next to your own name. */}
            <Tip label={isSearchOpen ? 'Close search' : 'Search people and groups'}>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleSearch}
                aria-label={isSearchOpen ? 'Close search' : 'Search people and groups'}
                aria-expanded={isSearchOpen}
                className={cn(isSearchOpen && 'bg-accent text-accent-foreground')}
              >
                <Search />
              </Button>
            </Tip>
            <Tip label="Mark everything read">
              <Button
                variant="ghost"
                size="icon"
                onClick={markAllRead}
                aria-label="Mark all conversations read"
              >
                <CheckCheck />
              </Button>
            </Tip>
            <Tip label="New group">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setCreatingGroup(true)}
                aria-label="New group"
              >
                {/* A bare plus says "add something" and nothing about WHAT — the
                    person-with-a-plus names the action without the tooltip. */}
                <UserRoundPlus />
              </Button>
            </Tip>
          </div>
        </div>

        {/* Revealed by the header icon. The term matches a group by name and a
            direct chat by the OTHER person's name — it searches who you talk to,
            never what was said. */}
        {isSearchOpen && (
          <div className="relative">
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  closeSearch()
                  return
                }
                // Up/down walk the results below and Enter opens one — the field
                // keeps focus throughout, so the term stays editable.
                onSearchKeyDown(e)
              }}
              placeholder="Search people and groups"
              className="px-8"
              aria-label="Search people and groups"
            />
            <Tip label="Clear search (Esc)">
              <button
                type="button"
                onClick={closeSearch}
                aria-label="Close search"
                className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-md p-1 text-muted-foreground"
              >
                <X className="size-4" />
              </button>
            </Tip>
          </div>
        )}

        {/* The filled chip plus three flat grey ones read as one live button
            beside three disabled ones — nothing said the grey three could be
            pressed. The affordance now lives on each CHIP: a hairline and card
            fill at rest, hover that moves toward the picked state, a press
            scale. No rail around the group — the row sits on the sidebar's own
            surface, so a second border and fill here would box in a control
            that is already legible. */}
        <div
          className="flex items-center gap-1"
          role="tablist"
          aria-label="Filter conversations"
        >
          {FILTERS.map((option) => {
            const isPicked = filter === option.value
            // How many CONVERSATIONS in this band have something unread — the
            // server's own count, not a sum over the rows we happen to hold. A
            // real zero means NO PILL: nothing to read is not a number worth
            // drawing, and an empty circle would read as "unknown".
            const unread = tabUnreadCount(unreadSummary, option.value)
            return (
              <button
                key={option.value}
                type="button"
                role="tab"
                aria-selected={isPicked}
                onClick={() => setFilter(option.value)}
                className={cn(
                  'flex flex-1 cursor-pointer items-center justify-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-all duration-150',
                  'active:scale-[0.97]',
                  isPicked
                    ? // The picked one is raised: brand fill and a shadow, so it
                      // sits ON the rail while the others sit IN it.
                      'bg-primary-fill text-primary-fill-foreground shadow-sm'
                    : // At rest: a hairline and a card fill, which is what makes it
                      // look pressable. Hover lifts it toward the picked state
                      // instead of merely tinting, so the target is unmistakable.
                      'border border-sidebar-border bg-card text-muted-foreground hover:border-primary/40 hover:bg-primary/10 hover:text-foreground hover:shadow-xs',
                )}
              >
                <span className="truncate">{option.label}</span>
                {unread > 0 && (
                  // On the picked chip the pill has to read against brand fill,
                  // so it inverts to the chip's own foreground rather than
                  // stacking a second saturated colour on the first.
                  <span
                    aria-label={`${unread} unread conversations`}
                    className={cn(
                      // A CIRCLE at one digit, a stadium at two or more: the
                      // height and the floor are both 1rem, so a lone "1" sits
                      // in a round badge instead of the squat oval that padding
                      // alone gave it, and "12" grows sideways from there.
                      'inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold tabular-nums',
                      isPicked
                        ? 'bg-primary-fill-foreground/20 text-primary-fill-foreground'
                        : 'bg-primary/15 text-primary',
                    )}
                  >
                    {formatBadge(unread)}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* The selection bar replaces the header actions rather than sitting beside
          them, so it is obvious the list is in a different mode. */}
      {hasSelection && (
        // A NEUTRAL surface, not brand paint: a full-width wash of the theme
        // colour sat under buttons that are themselves tinted, and the bar came
        // out heavier than anything it contained. The mode is carried by the
        // filled count chip and the rules above and below instead — one small
        // saturated thing on a quiet band, rather than two competing washes.
        // The sidebar's own accent, so the bar belongs to the list it acts on.
        <div className="flex shrink-0 items-center gap-2 border-y border-sidebar-border bg-sidebar-accent/60 px-3 py-2">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary-fill text-[10px] font-semibold text-primary-fill-foreground tabular-nums">
            {selectedIds.length > 99 ? '99+' : selectedIds.length}
          </span>
          {/* A group you are still IN can't be hidden — you leave it first — so
              when the selection holds nothing removable the line says WHY the
              action is dimmed. A disabled button takes no pointer events, so a
              tooltip would never be read here. */}
          <span className="min-w-0 flex-1 truncate text-xs font-medium">
            {selectedRemovableIds.length === 0
              ? 'Leave a group before removing it'
              : `selected of ${chats.length}`}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void deleteSelected()}
            disabled={selectedRemovableIds.length === 0}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            aria-label={`Remove ${selectedRemovableIds.length} selected conversations`}
          >
            <Trash2 />
            Remove
          </Button>
          <Tip label="Cancel">
            {/* Same treatment as the thread's selection bar — one gesture for
                "leave this mode", wherever the mode is running. */}
            <Button
              variant="ghost"
              size="icon"
              className={'size-8 rounded-full text-muted-foreground transition-colors hover:bg-card hover:text-foreground hover:shadow-xs [&_svg]:transition-transform [&_svg]:duration-200 hover:[&_svg]:rotate-90'}
              onClick={clearSelection}
              aria-label="Cancel selection"
            >
              <X />
            </Button>
          </Tip>
        </div>
      )}

      {/* The bottom padding is the account card's height plus its inset: the
          card sits ON this list, so without it the last row can never be
          scrolled out from under the glass. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-2 pb-20">
        {isLoading ? (
          <SidebarSkeleton />
        ) : chats.length === 0 && contacts.length === 0 && !isDirectoryLoading ? (
          <SidebarEmpty
            search={search}
            filter={filter}
            onNewGroup={() => setCreatingGroup(true)}
          />
        ) : (
          <div className="space-y-1">
            {/* While searching, the two sources are labelled: the rows above are
                conversations that exist, the rows below are people who would be
                a new one. Unlabelled they read as one list and clicking the
                wrong half is a surprise. */}
            {search && chats.length > 0 && <SectionLabel>Conversations</SectionLabel>}

            {/* Pinned chats already sort to the top; the header is what SAYS so,
                and it folds. While searching the split is dropped — hits are
                ranked by the term, and cutting them in two by pin state buries
                the one you were looking for under a header. */}
            {!search && pinnedChats.length > 0 ? (
              <>
                <ChatSection
                  label="Pinned"
                  chats={pinnedChats}
                  collapsed={folded.pinned}
                  onToggle={() => toggleFold('pinned')}
                >
                  {pinnedChats.map(chatRow)}
                </ChatSection>
                <ChatSection
                  label="Recent"
                  chats={recentChats}
                  collapsed={folded.recent}
                  onToggle={() => toggleFold('recent')}
                >
                  {recentChats.map(chatRow)}
                </ChatSection>
              </>
            ) : (
              chats.map(chatRow)
            )}

            {/* The directory — everyone you MAY start a chat with, matched
                server-side on the name and the Talk login. Only while a term is
                in the box; with none, this is the whole organisation. */}
            {search && (contacts.length > 0 || isDirectoryLoading) && (
              <>
                <SectionLabel>People</SectionLabel>
                {isDirectoryLoading && contacts.length === 0 ? (
                  <p className="px-2 py-2 text-xs text-muted-foreground">Searching people…</p>
                ) : (
                  contacts.map((contact) => (
                    <ContactRow
                      key={contact.talkUserId}
                      contact={contact}
                      isCursor={cursorKey === contactCursorKey(contact.talkUserId)}
                      isPending={isOpeningContact}
                      onOpen={openContact}
                    />
                  ))
                )}
              </>
            )}
          </div>
        )}
      </div>

      <SidebarAccountBar />

      {/* Leaving and deleting a group, asked from the row's own menu. The copy
          is the header's, so the same act reads the same wherever it started —
          and the owner's leave still names the heir it hands the group to. */}
      {rowConfirm.confirmChat !== null && (
        <ConfirmDialog
          {...(rowConfirm.confirmKind === 'disband'
            ? {
                title: 'Delete this group for everyone?',
                message: `${chatLabel(rowConfirm.confirmChat).title} and its messages go away for every member. This cannot be undone.`,
                confirmLabel: 'Delete for everyone',
              }
            : rowConfirm.confirmKind === 'leave'
              ? leaveGroupCopy(
                  chatLabel(rowConfirm.confirmChat).title,
                  canEditGroup(rowConfirm.confirmChat.self.memberRole),
                  rowConfirm.successorName,
                )
              : removeChatCopy(
                  chatLabel(rowConfirm.confirmChat).title,
                  rowConfirm.confirmChat.type === 'group',
                ))}
          tone="destructive"
          isPending={rowConfirm.isPending}
          onConfirm={() => void rowConfirm.run()}
          onCancel={rowConfirm.cancel}
        />
      )}

      {isCreatingGroup && <CreateGroupDialog onClose={() => setCreatingGroup(false)} />}
    </aside>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
      {children}
    </p>
  )
}
