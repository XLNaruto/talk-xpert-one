import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { createIdbStorage } from '@/lib/idb-storage'
import type { Id } from '@/types/api'
import type { Chat, ChatType, MemberRole, MessageType } from '@/features/chat/types'

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
 * - `append` — the next page of the SAME read: it extends the listing rather
 *   than replacing it, because a row the client never lists is a room it never
 *   joins, and a chat whose messages never arrive live.
 */
type ListScope = 'replace' | 'filter' | 'refresh' | 'append'

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
  /**
   * NOTE there is no unread ROLL-UP held here. Every row carries its own
   * `unread_count` and the socket keeps it live, so the sidebar's tab pills and
   * the tab-title badge are DERIVED from these rows — see
   * `features/chat/lib/unread-badges.ts`. A second copy of the same number,
   * fetched and pushed alongside them, could only ever disagree with the rows it
   * sits above.

  /**
   * A fresh page from `GET /talk/chats` (the API already ordered it). What it
   * does to the visible listing depends on WHY it was read — see `ListScope`.
   */
  setChats: (chats: Chat[], total: number, scope?: ListScope) => void
  /** Merge one chat's header in — from `GET /talk/chats/:id` or a socket event. */
  upsertChat: (chat: Chat) => void

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
      /**
       * Who ACTED, on a system event — it has no sender, so this is the only
       * person the row can name or draw. Null on an ordinary message, which
       * clears the one a previous system event left behind.
       */
      actor: { talkUserId: Id; name: string | null; photo: string | null } | null
      /**
       * True when the newest row is a tombstone. It must be SET as well as
       * cleared: a chat whose last message was deleted still gets ordinary
       * messages afterwards, and a stale flag would caption them as deleted.
       */
      deletedForEveryone: boolean
      /** Whether the row's message is read by everyone — my own ticks only. */
      readByAll: boolean
      /** Whether the row's message carries an edit. */
      edited: boolean
      /** Its kind, so a file can be named rather than called "Attachment". */
      type: MessageType
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
  /**
   * Set a row's badge to what is STILL unread, after a receipt that covered
   * only part of it. Reading the tenth message of ninety is not reading the
   * chat, and blanking the row there loses the other eighty.
   */
  setUnread: (chatId: Id, count: number) => void
  /** `PUT /talk/chats/:id/pin` — private to me, so re-sort locally. */
  setPinned: (chatId: Id, pinned: boolean) => void
  /** The group owner blocked or unblocked me from posting. */
  setSelfBlocked: (chatId: Id, blocked: boolean) => void
  /** I left, or was removed — the composer must go. */
  setSelfLeft: (chatId: Id) => void
  /**
   * `talk.member.role_changed` naming ME — I was promoted, demoted, or handed
   * the group when its owner left.
   *
   * This is the field every `canManage` check reads, so without it a promoted
   * member sees no new controls and a demoted one keeps stale ones until reload.
   */
  setSelfRole: (chatId: Id, memberRole: MemberRole) => void
  /**
   * Somebody joined or left: move the row's member count by `delta` NOW.
   *
   * The header reads `memberCount`, and the authoritative number only arrives
   * with the chat re-read that follows a `talk.member.*` event. Without this the
   * count sits at its old value for a round trip while the system message about
   * the change is already on screen. Floored at 1 — a group always holds its
   * owner — so a duplicated event cannot drive it negative, and the re-read
   * corrects it either way.
   */
  applyMemberDelta: (chatId: Id, delta: number) => void
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

      setChats: (chats, total, scope = 'replace') =>
        set((s) => {
          if (scope === 'append') {
            const incoming = new Map(chats.map((chat) => [chat.id, chat]))
            const refreshed = s.chats.map((held) => incoming.get(held.id) ?? held)
            const held = new Set(s.chats.map((chat) => chat.id))
            const added = chats.filter((chat) => !held.has(chat.id))
            const listedIds =
              s.listedIds === null
                ? null
                : [...s.listedIds, ...added.map((chat) => chat.id)]
            return {
              chats: added.length > 0 ? reorder([...refreshed, ...added]) : refreshed,
              listedIds,
              total,
              isLoaded: true,
            }
          }

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
            ? patchOne(s.chats, chat.id, (held) => ({
                ...held,
                ...chat,
                // A read DOES carry the actor, off `last_message_system_data` —
                // but a row rebuilt from anything thinner would blank the one
                // the socket learnt. Kept only while the row still describes the
                // SAME message; a newer one brings its own.
                lastMessageActor:
                  chat.lastMessageActor ??
                  (held.lastMessageAt === chat.lastMessageAt ? held.lastMessageActor : null),
                // Same rule for the tick: a read cannot say whether my last
                // message was read, so the value the cache gave us stands until
                // a NEWER message replaces the row's subject.
                lastMessageReadByAll:
                  chat.lastMessageReadByAll ||
                  (held.lastMessageAt === chat.lastMessageAt ? held.lastMessageReadByAll : false),
                lastMessageEdited:
                  chat.lastMessageEdited ||
                  (held.lastMessageAt === chat.lastMessageAt ? held.lastMessageEdited : false),
              }))
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

      applyIncoming: (
        chatId,
        {
          preview,
          at,
          senderTalkUserId,
          senderName,
          senderPhoto,
          actor,
          deletedForEveryone,
          readByAll,
          edited,
          type,
          countsAsUnread,
        },
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
            lastMessageActor: actor,
            lastMessageDeletedForEveryone: deletedForEveryone,
            lastMessageReadByAll: readByAll,
            lastMessageEdited: edited,
            lastMessageType: type,
            unreadCount: countsAsUnread ? chat.unreadCount + 1 : chat.unreadCount,
          }))
          return { chats: reorder(chats) }
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

      setUnread: (chatId, count) =>
        set((s) => {
          const chat = s.chats.find((c) => c.id === chatId)
          const next = Math.max(0, count)
          if (!chat || chat.unreadCount === next) return {}
          return { chats: patchOne(s.chats, chatId, (c) => ({ ...c, unreadCount: next })) }
        }),

      clearUnread: (chatId) =>
        set((s) => {
          const chat = s.chats.find((c) => c.id === chatId)
          if (!chat || chat.unreadCount === 0) return {}
          return { chats: patchOne(s.chats, chatId, (c) => ({ ...c, unreadCount: 0 })) }
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

      setSelfRole: (chatId, memberRole) =>
        set((s) => {
          const chat = s.chats.find((c) => c.id === chatId)
          if (!chat || chat.self.memberRole === memberRole) return {}
          return {
            chats: patchOne(s.chats, chatId, (held) => ({
              ...held,
              self: { ...held.self, memberRole },
            })),
          }
        }),

      applyMemberDelta: (chatId, delta) =>
        set((s) => {
          const chat = s.chats.find((c) => c.id === chatId)
          if (!chat || chat.type !== 'group' || delta === 0) return {}
          return {
            chats: patchOne(s.chats, chatId, (held) => ({
              ...held,
              memberCount: Math.max(1, held.memberCount + delta),
            })),
          }
        }),

      removeChats: (chatIds) =>
        set((s) => {
          const ids = new Set(chatIds)
          const going = s.chats.filter((c) => ids.has(c.id))
          if (going.length === 0) return {}
          // A disbanded group, a chat I hid and one I left each take their unread
          // away with them, because the badges are counted off these rows: only
          // chats the LIST shows are ever in the total.
          return {
            chats: s.chats.filter((c) => !ids.has(c.id)),
            listedIds: s.listedIds?.filter((id) => !ids.has(id)) ?? null,
            total: Math.max(0, s.total - going.length),
          }
        }),

      clear: () =>
        set({ chats: [], listedIds: null, total: 0, isLoaded: false }),
    }),
    {
      name: 'xpertone-talk-chats',
      storage: createJSONStorage(createIdbStorage),
      skipHydration: true,
      // `isLoaded` describes THIS launch — a restored list is a paint, not a read,
      // and the sidebar still shows its loading state until the refetch lands.
      // `listedIds` is left out on purpose: a restored session has no search
      // running, so it rehydrates as `null` and paints every cached row.
      partialize: (s) => ({ chats: s.chats, total: s.total }),
      // Bumped when the separately-held unread total was dropped: the badges are
      // derived from the rows now, so a persisted copy of that number is a stale
      // second answer to a question the rows already answer.
      version: 2,
      migrate: (state) => ({
        chats: (state as { chats?: Chat[] })?.chats ?? [],
        total: (state as { total?: number })?.total ?? 0,
      }),
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
