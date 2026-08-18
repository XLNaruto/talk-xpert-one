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
interface ChatListState {
  chats: Chat[]
  total: number
  /** Whether a first read has landed, so the sidebar can tell empty from unread. */
  isLoaded: boolean
  /** `GET /talk/chats/unread-summary` — the app badge. */
  totalUnread: number

  /** Replace the list with a fresh page (the API already ordered it). */
  setChats: (chats: Chat[], total: number) => void
  /** Merge one chat's header in — from `GET /talk/chats/:id` or a socket event. */
  upsertChat: (chat: Chat) => void
  setTotalUnread: (total: number) => void

  /**
   * A message arrived: refresh the preview, move the row to the top of its
   * pinned band, and add to the unread badge unless this chat is open.
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
 * Re-sort the way the server does: PINNED first, then newest activity.
 *
 * The list arrives already ordered and must not be re-sorted on arrival. This
 * runs only after a LOCAL change to the ordering keys — a new message, or a pin
 * I just toggled — so the row moves immediately instead of waiting for a refetch.
 */
function reorder(chats: Chat[]): Chat[] {
  return [...chats].sort((a, b) => {
    if (a.self.isPinned !== b.self.isPinned) return a.self.isPinned ? -1 : 1
    return (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt)
  })
}

function patchOne(chats: Chat[], chatId: Id, patch: (chat: Chat) => Chat): Chat[] {
  return chats.map((chat) => (chat.id === chatId ? patch(chat) : chat))
}

export const useChatListStore = create<ChatListState>()(
  persist(
    (set) => ({
      chats: [],
      total: 0,
      isLoaded: false,
      totalUnread: 0,

      setChats: (chats, total) => set({ chats, total, isLoaded: true }),

      upsertChat: (chat) =>
        set((s) => {
          const exists = s.chats.some((c) => c.id === chat.id)
          const chats = exists
            ? patchOne(s.chats, chat.id, (held) => ({ ...held, ...chat }))
            : [chat, ...s.chats]
          return { chats: reorder(chats), total: exists ? s.total : s.total + 1 }
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
            total: Math.max(0, s.total - going.length),
            totalUnread: Math.max(0, s.totalUnread - removedUnread),
          }
        }),

      clear: () => set({ chats: [], total: 0, isLoaded: false, totalUnread: 0 }),
    }),
    {
      name: 'xpertone-talk-chats',
      storage: createJSONStorage(createIdbStorage),
      skipHydration: true,
      // `isLoaded` describes THIS launch — a restored list is a paint, not a read,
      // and the sidebar still shows its loading state until the refetch lands.
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
