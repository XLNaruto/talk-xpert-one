import { useCallback, useMemo, useState } from 'react'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useChatListStore } from '@/stores/chat-list-store'
import { useChatStore } from '@/stores/chat-store'
import { useUiStore } from '@/stores/ui-store'
import type { Id } from '@/types/api'
import { useChats } from '../api/use-chats'
import { useChatActions } from '../api/use-chat-actions'
import { useMessageActions } from '../api/use-message-actions'
import { usePresence, useBlockList } from '../api/use-presence'
import type { ChatType } from '../types'

/** Which band of the list the sidebar is showing. */
export type ChatFilter = 'all' | 'direct' | 'group' | 'unread'

/**
 * Conversation-list screen logic: search, filtering, selection, pinning, bulk
 * actions. `chat-sidebar.tsx` renders what this returns and decides nothing.
 *
 * Mounted ONCE, by the sidebar. `useChats` reads into a store, so a second mount
 * would issue a second identical request against the same rows.
 */
export function useChatList() {
  const [search, setSearch] = useState('')
  /**
   * The search field is revealed by the header icon rather than standing open —
   * the list is the sidebar's job, and a permanent field costs a row of height
   * on every screen to serve the minority of visits that are looking for a name.
   */
  const [isSearchOpen, setSearchOpen] = useState(false)
  const [filter, setFilter] = useState<ChatFilter>('all')
  /** Ids ticked for a bulk delete or forward. Empty means selection mode is off. */
  const [selectedIds, setSelectedIds] = useState<Id[]>([])

  // Server-side search, and it has to be: it matches a group on its name AND a
  // direct chat on the OTHER participant's name, which no client-side filter of
  // the response could do.
  const debouncedSearch = useDebouncedValue(search, 300)

  const { chats, isLoading, isFetching, refetch } = useChats({
    search: debouncedSearch || undefined,
    type: filter === 'direct' || filter === 'group' ? (filter as ChatType) : undefined,
    unreadOnly: filter === 'unread' || undefined,
  })

  usePresence()
  useBlockList()

  const activeChatId = useChatStore((s) => s.activeChatId)
  const setActiveChat = useChatStore((s) => s.setActiveChat)
  const clearTyping = useChatStore((s) => s.clearTyping)
  const totalUnread = useChatListStore((s) => s.totalUnread)
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen)
  const { setChatPinned, deleteForMe } = useChatActions()
  const { markRead } = useMessageActions()

  const selectChat = useCallback(
    (chatId: Id) => {
      setActiveChat(chatId)
      // On mobile the list is an overlay — opening a thread should close it.
      setSidebarOpen(false)
      // Whoever was typing in the last thread is not typing in this one.
      clearTyping()
      // Opening a thread clears its badge and turns the sender's ticks blue.
      markRead([chatId])
    },
    [setActiveChat, setSidebarOpen, clearTyping, markRead],
  )

  const toggleSelected = useCallback((chatId: Id) => {
    setSelectedIds((held) =>
      held.includes(chatId) ? held.filter((id) => id !== chatId) : [...held, chatId],
    )
  }, [])

  const clearSelection = useCallback(() => setSelectedIds([]), [])

  /**
   * A bulk delete only ever offers direct chats, because the API refuses a group
   * with a 400 naming the offending ids — so the count shown must match what will
   * actually go.
   */
  const selectedDirectIds = useMemo(
    () =>
      selectedIds.filter((id) => chats.find((chat) => chat.id === id)?.type === 'direct'),
    [selectedIds, chats],
  )

  const deleteSelected = useCallback(async () => {
    if (selectedDirectIds.length === 0) return
    const ok = await deleteForMe(selectedDirectIds)
    if (ok) clearSelection()
  }, [selectedDirectIds, deleteForMe, clearSelection])

  /**
   * Closing search clears the term, so the list is never left filtered by a
   * field the user can no longer see.
   */
  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    setSearch('')
  }, [])

  const toggleSearch = useCallback(() => {
    setSearchOpen((open) => {
      if (open) setSearch('')
      return !open
    })
  }, [])

  /** "Mark all read" — one statement, whatever the count. */
  const markAllRead = useCallback(() => {
    const unread = chats.filter((chat) => chat.unreadCount > 0).map((chat) => chat.id)
    markRead(unread)
  }, [chats, markRead])

  return {
    chats,
    isLoading,
    isFetching,
    refetch,
    search,
    setSearch,
    isSearchOpen,
    toggleSearch,
    closeSearch,
    filter,
    setFilter,
    totalUnread,
    activeChatId,
    selectChat,
    setChatPinned,
    selectedIds,
    selectedDirectIds,
    toggleSelected,
    clearSelection,
    deleteSelected,
    markAllRead,
    hasSelection: selectedIds.length > 0,
  }
}
