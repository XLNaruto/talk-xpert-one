import { useCallback, useMemo, useState } from 'react'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useChatListStore } from '@/stores/chat-list-store'
import { useChatStore } from '@/stores/chat-store'
import { useUiStore } from '@/stores/ui-store'
import type { Id } from '@/types/api'
import { canHideChat } from '../lib/chat-labels'
import { deriveUnreadSummary } from '../lib/unread-badges'
import { useChats } from '../api/use-chats'
import { useContacts } from '../api/use-contacts'
import { useChatActions } from '../api/use-chat-actions'
import { useMessageActions } from '../api/use-message-actions'
import { usePresence, useBlockList } from '../api/use-presence'
import { useChatConfirmActions } from './use-chat-header-actions'
import { useSearchCursor } from './use-search-cursor'
import type { ChatFilter, ChatType, Contact } from '../types'

export type { ChatFilter }

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

  /**
   * The directory, searched alongside the conversation list.
   *
   * A name you have never messaged is in `GET /talk/contacts` and nowhere else,
   * so a sidebar that only searched `GET /talk/chats` could not find a new
   * colleague at all. Read ONLY while the field is open and holds a term —
   * `/talk/contacts` with no search is the whole organisation, which is the
   * picker's job, not the sidebar's.
   */
  const searchTerm = search.trim()
  const {
    contacts: directory,
    isLoading: isDirectoryLoading,
    isSearching: isDirectorySearching,
  } = useContacts({
    search,
    enabled: isSearchOpen && searchTerm.length > 0,
  })

  usePresence()
  useBlockList()

  const activeChatId = useChatStore((s) => s.activeChatId)
  const setActiveChat = useChatStore((s) => s.setActiveChat)
  const clearTyping = useChatStore((s) => s.clearTyping)
  const setDetailsOpen = useChatStore((s) => s.setDetailsOpen)
  /**
   * The tab pills, counted from the rows themselves.
   *
   * The store's WHOLE inventory, not the visible listing: with the Direct tab
   * picked the listing holds direct chats only, and the Groups pill derived from
   * that would read zero while groups sat unread behind it. Every row's
   * `unread_count` is kept live by the socket, so the pills move with the
   * conversation without a second number to fetch or reconcile.
   */
  const knownChats = useChatListStore((s) => s.chats)
  const unreadSummary = useMemo(() => deriveUnreadSummary(knownChats), [knownChats])
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen)
  const { setChatPinned, deleteForMe, openDirect, isPending: isOpeningContact } = useChatActions()
  const { markRead } = useMessageActions()

  const selectChat = useCallback(
    (chatId: Id) => {
      setActiveChat(chatId)
      // On mobile the list is an overlay — opening a thread should close it.
      setSidebarOpen(false)
      // Whoever was typing in the last thread is not typing in this one.
      clearTyping()
      // Picking a result ENDS the search — by arrow-and-Enter or by click. The
      // term has done its job, and a field left open behind the thread keeps the
      // list filtered by something the reader has stopped thinking about.
      setSearchOpen(false)
      setSearch('')
      // OPENING is not reading. Marking the whole chat read here cleared the
      // badge before the thread had even mounted — so `use-thread-scroll` found
      // no unread count to anchor on, skipped the divider, dropped the reader at
      // the newest message and reported fifty-two messages read that nobody had
      // seen. The thread marks what reaches the VIEWPORT, one screenful at a
      // time; the badge walks down with the reader instead of vanishing.
    },
    [setActiveChat, setSidebarOpen, clearTyping],
  )

  /**
   * A row's "Group info". The sheet belongs to the OPEN thread, so this opens
   * the chat first and then the sheet — the store carries the second half,
   * because the sidebar cannot reach the thread pane's own state.
   */
  const openChatInfo = useCallback(
    (chatId: Id) => {
      selectChat(chatId)
      setDetailsOpen(true)
    },
    [selectChat, setDetailsOpen],
  )

  const toggleSelected = useCallback((chatId: Id) => {
    setSelectedIds((held) =>
      held.includes(chatId) ? held.filter((id) => id !== chatId) : [...held, chatId],
    )
  }, [])

  const clearSelection = useCallback(() => setSelectedIds([]), [])

  /**
   * What a bulk delete would actually take: direct chats, and groups already
   * LEFT. The API refuses a group you are still in with a 400 naming the ids, so
   * the count shown has to match what will really go.
   */
  const selectedRemovableIds = useMemo(
    () =>
      selectedIds.filter((id) => {
        const chat = chats.find((candidate) => candidate.id === id)
        return chat !== undefined && canHideChat(chat)
      }),
    [selectedIds, chats],
  )

  const deleteSelected = useCallback(async () => {
    if (selectedRemovableIds.length === 0) return
    const ok = await deleteForMe(selectedRemovableIds)
    if (ok) clearSelection()
  }, [selectedRemovableIds, deleteForMe, clearSelection])

  /**
   * The row's own action, behind a right-click. Removing a row is asked about
   * through `rowConfirm` below instead — hiding a group you have left cannot be
   * undone, so it is never one click away.
   */
  const markChatRead = useCallback((chatId: Id) => markRead([chatId]), [markRead])

  /**
   * Directory hits worth showing: anyone whose existing chat is already a row
   * above would otherwise appear twice under two different labels.
   */
  const contacts = useMemo(() => {
    if (!searchTerm) return []
    return directory.filter(
      (contact) =>
        contact.existingChatId === null ||
        !chats.some((chat) => chat.id === contact.existingChatId),
    )
  }, [chats, directory, searchTerm])

  /**
   * Opening a directory hit. `existing_chat_id` rides along on the row, so a
   * person you already talk to costs no request at all; anyone else goes through
   * `POST /talk/chats/direct`, which is idempotent.
   */
  const openContact = useCallback(
    async (contact: Contact) => {
      const chatId = contact.existingChatId ?? (await openDirect(contact.talkUserId))
      if (chatId === null) return
      selectChat(chatId)
      setSearchOpen(false)
      setSearch('')
    },
    [openDirect, selectChat],
  )

  /**
   * Leaving and disbanding, asked about whichever ROW was right-clicked — the
   * same question the thread header asks, so the copy and the succession read
   * are shared rather than written twice.
   */
  const rowConfirm = useChatConfirmActions()

  /**
   * Up/down/Enter over the two result lists. Mounted here rather than in the
   * sidebar because it drives the same two picks the rest of this hook owns.
   */
  const { cursorKey, setCursorKey, onKeyDown: onSearchKeyDown } = useSearchCursor({
    chats,
    contacts,
    enabled: isSearchOpen && searchTerm.length > 0,
    onPickChat: selectChat,
    onPickContact: openContact,
  })

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
    unreadSummary,
    /** The tab-title badge: unread MESSAGES, where a pill counts chats. */
    totalUnread: unreadSummary.totalUnread,
    activeChatId,
    selectChat,
    openChatInfo,
    setChatPinned,
    selectedIds,
    selectedRemovableIds,
    toggleSelected,
    clearSelection,
    deleteSelected,
    markAllRead,
    markChatRead,
    hasSelection: selectedIds.length > 0,
    contacts,
    /** True until the directory has answered the term now in the box. */
    isDirectoryLoading: isDirectoryLoading || isDirectorySearching,
    openContact,
    isOpeningContact,
    /** Which result row the keyboard is on — `null` until an arrow is pressed. */
    cursorKey,
    setCursorKey,
    onSearchKeyDown,
    rowConfirm,
  }
}
