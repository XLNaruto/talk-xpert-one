import { useState } from 'react'
import { CheckCheck, Search, Trash2, UserRoundPlus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { BrandLogo } from '@/components/common/brand-logo'
import { EmptyState } from '@/components/common/empty-state'
import { Tip } from '@/components/common/tip'
import { useAuthStore } from '@/stores/auth-store'
import { cn } from '@/lib/utils'
import { useChatList, type ChatFilter } from '../hooks/use-chat-list'
import { ChatListItem } from './chat-list-item'
import { ContactRow } from './contact-row'
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
    activeChatId,
    selectChat,
    setChatPinned,
    deleteChat,
    markChatRead,
    selectedIds,
    selectedDirectIds,
    toggleSelected,
    clearSelection,
    deleteSelected,
    markAllRead,
    hasSelection,
    contacts,
    isDirectoryLoading,
    openContact,
    isOpeningContact,
  } = useChatList()

  const selfTalkUserId = useAuthStore((s) => s.identity?.talkUserId ?? null)
  const [isCreatingGroup, setCreatingGroup] = useState(false)

  return (
    <aside className="flex h-full w-full flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:w-80 md:border-r-0">
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
                if (e.key === 'Escape') closeSearch()
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

        <div className="flex gap-1" role="tablist" aria-label="Filter conversations">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={filter === option.value}
              onClick={() => setFilter(option.value)}
              className={cn(
                'rounded-full px-2.5 py-1 text-xs transition-colors',
                filter === option.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground hover:bg-accent',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* The selection bar replaces the header actions rather than sitting beside
          them, so it is obvious the list is in a different mode. */}
      {hasSelection && (
        <div className="flex shrink-0 items-center gap-2 border-y border-sidebar-border px-3 py-2">
          <span className="flex-1 text-xs">{selectedIds.length} selected</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void deleteSelected()}
            // Groups can't be hidden this way — leave the group instead — so the
            // action is offered only when the selection contains something valid.
            disabled={selectedDirectIds.length === 0}
            aria-label="Remove selected conversations"
          >
            <Trash2 />
            Remove
          </Button>
          <Button variant="ghost" size="icon" onClick={clearSelection} aria-label="Cancel">
            <X />
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {isLoading ? (
          <SidebarSkeleton />
        ) : chats.length === 0 && contacts.length === 0 && !isDirectoryLoading ? (
          <EmptyState
            title={search ? 'No matches' : filter === 'unread' ? 'Nothing unread' : 'No conversations yet'}
            description={
              search
                ? 'Try a different name, or ask an administrator for access to more people.'
                : filter === 'unread'
                  ? 'You are caught up.'
                  : 'Start a group to get talking.'
            }
            action={
              !search && filter === 'all' ? (
                <Button size="sm" onClick={() => setCreatingGroup(true)}>
                  <UserRoundPlus />
                  New group
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="space-y-1.5">
            {/* While searching, the two sources are labelled: the rows above are
                conversations that exist, the rows below are people who would be
                a new one. Unlabelled they read as one list and clicking the
                wrong half is a surprise. */}
            {search && chats.length > 0 && <SectionLabel>Conversations</SectionLabel>}

            {chats.map((chat) => (
              <ChatListItem
                key={chat.id}
                chat={chat}
                isActive={chat.id === activeChatId}
                selfTalkUserId={selfTalkUserId}
                isSelected={hasSelection ? selectedIds.includes(chat.id) : null}
                onSelect={selectChat}
                onToggleSelected={toggleSelected}
                onPin={setChatPinned}
                onMarkRead={markChatRead}
                onDelete={deleteChat}
              />
            ))}

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
