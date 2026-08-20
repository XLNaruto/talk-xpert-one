import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { createIdbStorage } from '@/lib/idb-storage'
import type { Id } from '@/types/api'
import type { Chat, ChatType } from '@/features/chat/types'

/**
 * The chat list, cached so the socket can keep it live.
 *
 * This is the SECOND deliberate overlap with the "server data lives in the
 * feature's api/ hooks" rule, and for the same reason as the message cache:
 * `talk.message.new` has to bump a row to the top, update its preview and add to
 * its unread badge, and `talk.chat.*` / `talk.member.*` insert and remove rows.
 * A list held in a hook's `useState` is unreachable from a socket handler.
 *
 * It caches only. Fetching stays in `features/chat/api/use-chats.ts`, which is
 * the only thing that calls axios and then writes here.
 */
/**
 * Why a list read happened, and so what it may do to the visible listing.
 *
 * - `replace` — an unfiltered read: it is the inventory, and nothing is hidden.
 * - `filter` — a search or a tab: it answers a question, so it refreshes the
 *   rows it returned and records which they were, keeping the rest.
 * - `refresh` — the reconnect catch-up: it renews every row and its socket
 *   grant, but it is nobody's query, so it leaves the listing alone.
 */
type ListScope = 'replace' | 'filter' | 'refresh'

interface ChatListState {
  /**
   * Every chat we know about — NOT what the sidebar draws.
   *
   * A search or a tab filter answers a question; it is not an inventory. If a
   * filtered read replaced this outright, the open conversation would be evicted
   * the moment its name stopped matching, and the thread would collapse to "Pick
   * a conversation" mid-search. Its socket room would go with it, too, since the
   * reconnect re-join walks exactly these ids.
   */
  chats: Chat[]
  /** Which of them the last list read returned. `null` means "all of them". */
  listedIds: Id[] | null
  total: number
  /** Whether a first read has landed, so the sidebar can tell empty from unread. */
  isLoaded: boolean
  /** `GET /talk/chats/unread-summary` — the app badge. */
  totalUnread: number

  /**
   * A fresh page from `GET /talk/chats` (the API already ordered it). What it
   * does to the visible listing depends on WHY it was read — see `ListScope`.
   */
  setChats: (chats: Chat[], total: number, scope?: ListScope) => void
  /** Merge one chat's header in — from `GET /talk/chats/:id` or a socket event. */
  upsertChat: (chat: Chat) => void
  setTotalUnread: (total: number) => void

  /**
   * A message arrived: refresh the preview, move the row to the top of its
   * pinned band, and add to the unread badge unless this chat is open.
   *
   * The preview, the timestamp and the sender are set together and always
   * describe the SAME message — the newest one visible to me — which is the
   * contract the server's own row keeps.
   */
  applyIncoming: (
    chatId: Id,
    args: {
      preview: string | null
      at: string
      senderTalkUserId: Id | null
      /** Who spoke — the "Asha: " prefix on a group row. */
      senderName: string | null
      senderPhoto: string | null
      /** False when the chat is open on screen, or the message is my own. */
      countsAsUnread: boolean
    },
  ) => void
  /** `talk.chat.updated` — group renamed or repictured. */
  applyChatUpdated: (
    chatId: Id,
    patch: { name?: string | null; description?: string | null; avatarUrl?: string | null },
  ) => void
  /** Clear a row's badge after `POST /talk/chats/read`. */
  clearUnread: (chatId: Id) => void
  /** `PUT /talk/chats/:id/pin` — private to me, so re-sort locally. */
  setPinned: (chatId: Id, pinned: boolean) => void
  /** The group owner blocked or unblocked me from posting. */
  setSelfBlocked: (chatId: Id, blocked: boolean) => void
  /** I left, or was removed — the composer must go. */
  setSelfLeft: (chatId: Id) => void
  /** Disbanded, removed, or hidden from my list. */
  removeChats: (chatIds: Id[]) => void
  clear: () => void
}

/**
 * Re-sort the way the server does: PINNED first, then by MY OWN last visible
 * message, and chats with nothing left to show last.
 *
 * `lastMessageAt` is per viewer — it is when the newest message *I* can still
 * see was sent — so it is null on a chat I cleared with nothing newer since, and
 * on one nobody has spoken in. Those sort to the bottom rather than borrowing
 * `createdAt`, which would float a freshly created empty chat over conversations
 * that actually have something in them.
 *
 * The list arrives already ordered and must not be re-sorted on arrival. This
 * runs only after a LOCAL change to the ordering keys — a new message, or a pin
 * I just toggled — so the row moves immediately instead of waiting for a refetch.
 */
function reorder(chats: Chat[]): Chat[] {
  return [...chats].sort((a, b) => {
    if (a.self.isPinned !== b.self.isPinned) return a.self.isPinned ? -1 : 1
    if (!a.lastMessageAt || !b.lastMessageAt) {
      if (a.lastMessageAt) return -1
      if (b.lastMessageAt) return 1
      // Both empty: newest chat first, so a group just created is reachable.
      return b.createdAt.localeCompare(a.createdAt)
    }
    return b.lastMessageAt.localeCompare(a.lastMessageAt)
  })
}

function patchOne(chats: Chat[], chatId: Id, patch: (chat: Chat) => Chat): Chat[] {
  return chats.map((chat) => (chat.id === chatId ? patch(chat) : chat))
}

export const useChatListStore = create<ChatListState>()(
  persist(
    (set) => ({
      chats: [],
      listedIds: null,
      total: 0,
      isLoaded: false,
      totalUnread: 0,

      setChats: (chats, total, scope = 'replace') =>
        set((s) => {
          if (scope !== 'filter') {
            return {
              chats,
              listedIds: scope === 'refresh' ? s.listedIds : null,
              total,
              isLoaded: true,
            }
          }

          const incoming = new Map(chats.map((chat) => [chat.id, chat]))
          const refreshed = s.chats.map((held) => incoming.get(held.id) ?? held)
          const held = new Set(s.chats.map((chat) => chat.id))
          const added = chats.filter((chat) => !held.has(chat.id))

          return {
            chats: added.length > 0 ? reorder([...refreshed, ...added]) : refreshed,
            listedIds: chats.map((chat) => chat.id),
            total,
            isLoaded: true,
          }
        }),

      upsertChat: (chat) =>
        set((s) => {
          const exists = s.chats.some((c) => c.id === chat.id)
          const chats = exists
            ? patchOne(s.chats, chat.id, (held) => ({ ...held, ...chat }))
            : [chat, ...s.chats]
          return {
            chats: reorder(chats),
            // A chat opened while a search is running — from a directory hit —
            // belongs in the results, not hidden behind the term that found it.
            listedIds:
              s.listedIds === null || exists ? s.listedIds : [chat.id, ...s.listedIds],
            total: exists ? s.total : s.total + 1,
          }
        }),

      setTotalUnread: (totalUnread) => set({ totalUnread }),

      applyIncoming: (
        chatId,
        { preview, at, senderTalkUserId, senderName, senderPhoto, countsAsUnread },
      ) =>
        set((s) => {
          // A message for a chat we don't hold means the list is stale (we were
          // just added). The stream re-reads the list in that case; dropping the
          // event here is correct, since inventing a row would show a blank one.
          if (!s.chats.some((c) => c.id === chatId)) return {}
          const chats = patchOne(s.chats, chatId, (chat) => ({
            ...chat,
            lastMessagePreview: preview,
            lastMessageAt: at,
            lastMessageSenderTalkUserId: senderTalkUserId,
            lastMessageSenderName: senderName,
            lastMessageSenderPhoto: senderPhoto,
            unreadCount: countsAsUnread ? chat.unreadCount + 1 : chat.unreadCount,
          }))
          return {
            chats: reorder(chats),
            totalUnread: countsAsUnread ? s.totalUnread + 1 : s.totalUnread,
          }
        }),

      applyChatUpdated: (chatId, patch) =>
        set((s) => ({
          chats: patchOne(s.chats, chatId, (chat) => ({
            ...chat,
            name: patch.name !== undefined ? patch.name : chat.name,
            description:
              patch.description !== undefined ? patch.description : chat.description,
            avatarUrl: patch.avatarUrl !== undefined ? patch.avatarUrl : chat.avatarUrl,
          })),
        })),

      clearUnread: (chatId) =>
        set((s) => {
          const chat = s.chats.find((c) => c.id === chatId)
          if (!chat || chat.unreadCount === 0) return {}
          return {
            chats: patchOne(s.chats, chatId, (c) => ({ ...c, unreadCount: 0 })),
            totalUnread: Math.max(0, s.totalUnread - chat.unreadCount),
          }
        }),

      setPinned: (chatId, pinned) =>
        set((s) => ({
          chats: reorder(
            patchOne(s.chats, chatId, (chat) => ({
              ...chat,
              self: { ...chat.self, isPinned: pinned },
            })),
          ),
        })),

      setSelfBlocked: (chatId, blocked) =>
        set((s) => ({
          chats: patchOne(s.chats, chatId, (chat) => ({
            ...chat,
            self: { ...chat.self, isBlocked: blocked },
          })),
        })),

      setSelfLeft: (chatId) =>
        set((s) => ({
          chats: patchOne(s.chats, chatId, (chat) => ({
            ...chat,
            self: { ...chat.self, hasLeft: true },
          })),
        })),

      removeChats: (chatIds) =>
        set((s) => {
          const ids = new Set(chatIds)
          const going = s.chats.filter((c) => ids.has(c.id))
          if (going.length === 0) return {}
          const removedUnread = going.reduce((sum, c) => sum + c.unreadCount, 0)
          return {
            chats: s.chats.filter((c) => !ids.has(c.id)),
            listedIds: s.listedIds?.filter((id) => !ids.has(id)) ?? null,
            total: Math.max(0, s.total - going.length),
            totalUnread: Math.max(0, s.totalUnread - removedUnread),
          }
        }),

      clear: () =>
        set({ chats: [], listedIds: null, total: 0, isLoaded: false, totalUnread: 0 }),
    }),
    {
      name: 'xpertone-talk-chats',
      storage: createJSONStorage(createIdbStorage),
      skipHydration: true,
      // `isLoaded` describes THIS launch — a restored list is a paint, not a read,
      // and the sidebar still shows its loading state until the refetch lands.
      // `listedIds` is left out on purpose: a restored session has no search
      // running, so it rehydrates as `null` and paints every cached row.
      partialize: (s) => ({ chats: s.chats, total: s.total, totalUnread: s.totalUnread }),
    },
  ),
)

/** Read one chat outside React (socket handlers, the catch-up). */
export function cachedChat(chatId: Id): Chat | undefined {
  return useChatListStore.getState().chats.find((c) => c.id === chatId)
}

/** Every chat id we hold — what the reconnect re-join walks. */
export function cachedChatIds(): Id[] {
  return useChatListStore.getState().chats.map((c) => c.id)
}

/** The counterparts whose presence we actually display — see the filter rule. */
export function counterpartIds(type?: ChatType): Id[] {
  return useChatListStore
    .getState()
    .chats.filter((c) => (type ? c.type === type : true))
    .map((c) => c.counterpartTalkUserId)
    .filter((id): id is Id => id !== null)
}
