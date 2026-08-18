import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { createIdbStorage } from '@/lib/idb-storage'
import { keyOf, type Id } from '@/types/api'
import type { ChatMessage } from '@/features/chat/types'

/**
 * Offline-first message cache — Talk's answer to a server-state library.
 *
 * The REST API is the source of truth and the socket is an accelerator, so both
 * feed this one store: a page of history merges in, a `talk.message.new` merges
 * in, and components only ever read the result. A cold start paints from
 * IndexedDB before the first request resolves.
 *
 * Everything here merges by `id`. That is not an optimisation — the gateway
 * delivers events to the conversation's room and OUR OWN sockets are in it, so
 * we receive an echo of everything we send. Without id-merging every message we
 * sent would render twice.
 */

/** Per-chat paging state, kept beside the rows it describes. */
interface ChatPaging {
  /** Oldest id held — the next `before_id`. Null until the first page lands. */
  oldestId: Id | null
  /** False once a short page proves we reached the start of history. */
  hasMore: boolean
}

interface MessageCacheState {
  /** Messages per chat, OLDEST FIRST (the API answers newest-first). */
  byChat: Record<string, ChatMessage[]>
  paging: Record<string, ChatPaging>

  /** Merge a page or a single arrival. Rows already held win on any field the
   * incoming copy omits, so a lean event can't blank a full row. */
  upsertMany: (chatId: Id, messages: ChatMessage[]) => void
  upsertOne: (chatId: Id, message: ChatMessage) => void
  /** Record a history page's paging state alongside its rows. */
  setPage: (chatId: Id, messages: ChatMessage[], paging: Partial<ChatPaging>) => void

  /**
   * Replace the optimistic bubble with the server's row.
   *
   * Matched on `clientMessageId`, not on id — the placeholder's id is a local
   * negative one. This is also what makes the `talk.message.new` echo of our own
   * send land on the existing bubble instead of appending a second.
   */
  reconcile: (chatId: Id, clientMessageId: string, saved: ChatMessage) => void
  /** Flip a failed send to `failed`, keeping the bubble so it can be retried. */
  markFailed: (chatId: Id, clientMessageId: string) => void
  setUploadProgress: (chatId: Id, clientMessageId: string, fraction: number) => void

  /** `talk.message.edited` — replace the body and flag it. */
  applyEdit: (chatId: Id, messageId: Id, body: string | null, editedAt: string) => void
  /**
   * `talk.message.deleted` — delete for EVERYONE. The bubble stays as a
   * tombstone because replies still point at it.
   */
  applyDeleteForEveryone: (chatId: Id, messageIds: Id[]) => void
  /** Delete FOR ME — the row is genuinely gone from my view. */
  removeMany: (chatId: Id, messageIds: Id[]) => void
  /** `talk.message.read` — turn my own ticks blue. */
  applyRead: (chatId: Id, messageIds: Id[]) => void
  applyPinned: (chatId: Id, messageId: Id, pinned: boolean) => void

  /** Drop one chat entirely (disbanded, removed, or deleted from my list). */
  clearChat: (chatId: Id) => void
  clear: () => void
}

/**
 * Merge by id, oldest first.
 *
 * The incoming copy is spread OVER the held one, so a fuller row replaces a
 * leaner one field by field. Ordering is by `created_at` with the id as the
 * tiebreak: two messages inside the same second must still land in send order,
 * and the id is the only monotonic thing available.
 */
function merge(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const map = new Map(existing.map((m) => [m.id, m]))
  for (const message of incoming) {
    const held = map.get(message.id)
    map.set(message.id, held ? { ...held, ...message } : message)
  }
  return [...map.values()].sort(byOldestFirst)
}

function byOldestFirst(a: ChatMessage, b: ChatMessage): number {
  const at = a.createdAt.localeCompare(b.createdAt)
  return at !== 0 ? at : a.id - b.id
}

/** Rewrite the rows of one chat, leaving every other chat's array untouched. */
function patchChat(
  state: MessageCacheState,
  chatId: Id,
  patch: (messages: ChatMessage[]) => ChatMessage[],
): Pick<MessageCacheState, 'byChat'> {
  const key = keyOf(chatId)
  return { byChat: { ...state.byChat, [key]: patch(state.byChat[key] ?? []) } }
}

/** Apply a change to whichever rows match, leaving the rest identical. */
function mapWhere(
  messages: ChatMessage[],
  match: (message: ChatMessage) => boolean,
  change: (message: ChatMessage) => ChatMessage,
): ChatMessage[] {
  return messages.map((message) => (match(message) ? change(message) : message))
}

export const useMessageCacheStore = create<MessageCacheState>()(
  persist(
    (set) => ({
      byChat: {},
      paging: {},

      upsertMany: (chatId, messages) =>
        set((s) => patchChat(s, chatId, (held) => merge(held, messages))),

      upsertOne: (chatId, message) =>
        set((s) => patchChat(s, chatId, (held) => merge(held, [message]))),

      setPage: (chatId, messages, paging) =>
        set((s) => {
          const key = keyOf(chatId)
          const held = s.paging[key] ?? { oldestId: null, hasMore: true }
          return {
            ...patchChat(s, chatId, (rows) => merge(rows, messages)),
            paging: { ...s.paging, [key]: { ...held, ...paging } },
          }
        }),

      reconcile: (chatId, clientMessageId, saved) =>
        set((s) =>
          patchChat(s, chatId, (held) => {
            // Drop the placeholder, then merge the real row in — merging first
            // would leave both, since they carry different ids.
            const without = held.filter((m) => m.clientMessageId !== clientMessageId)
            return merge(without, [{ ...saved, status: 'sent', clientMessageId }])
          }),
        ),

      markFailed: (chatId, clientMessageId) =>
        set((s) =>
          patchChat(s, chatId, (held) =>
            mapWhere(
              held,
              (m) => m.clientMessageId === clientMessageId,
              (m) => ({ ...m, status: 'failed', uploadProgress: undefined }),
            ),
          ),
        ),

      setUploadProgress: (chatId, clientMessageId, fraction) =>
        set((s) =>
          patchChat(s, chatId, (held) =>
            mapWhere(
              held,
              (m) => m.clientMessageId === clientMessageId,
              (m) => ({ ...m, uploadProgress: fraction }),
            ),
          ),
        ),

      applyEdit: (chatId, messageId, body, editedAt) =>
        set((s) =>
          patchChat(s, chatId, (held) =>
            mapWhere(
              held,
              (m) => m.id === messageId,
              (m) => ({ ...m, body, isEdited: true, editedAt }),
            ),
          ),
        ),

      applyDeleteForEveryone: (chatId, messageIds) =>
        set((s) => {
          const ids = new Set(messageIds)
          return patchChat(s, chatId, (held) =>
            mapWhere(
              held,
              (m) => ids.has(m.id),
              // The tombstone keeps the row and its attachments' absence: the
              // body goes, the bubble stays, replies still resolve against it.
              (m) => ({
                ...m,
                body: null,
                media: [],
                isDeletedForEveryone: true,
                isPinned: false,
              }),
            ),
          )
        }),

      removeMany: (chatId, messageIds) =>
        set((s) => {
          const ids = new Set(messageIds)
          return patchChat(s, chatId, (held) => held.filter((m) => !ids.has(m.id)))
        }),

      applyRead: (chatId, messageIds) =>
        set((s) => {
          const ids = new Set(messageIds)
          return patchChat(s, chatId, (held) =>
            mapWhere(
              held,
              (m) => ids.has(m.id),
              (m) => ({
                ...m,
                isReadByAll: true,
                readCount: Math.max(1, m.readCount),
                status: m.status === 'sending' ? m.status : 'read',
              }),
            ),
          )
        }),

      applyPinned: (chatId, messageId, pinned) =>
        set((s) =>
          patchChat(s, chatId, (held) =>
            mapWhere(
              held,
              (m) => m.id === messageId,
              (m) => ({ ...m, isPinned: pinned }),
            ),
          ),
        ),

      clearChat: (chatId) =>
        set((s) => {
          const key = keyOf(chatId)
          const byChat = { ...s.byChat }
          const paging = { ...s.paging }
          delete byChat[key]
          delete paging[key]
          return { byChat, paging }
        }),

      clear: () => set({ byChat: {}, paging: {} }),
    }),
    {
      name: 'xpertone-talk-messages',
      storage: createJSONStorage(createIdbStorage),
      skipHydration: true,
      // In-flight sends are not worth restoring: the request died with the tab,
      // so a persisted `sending` bubble would spin for ever. A `failed` one is
      // kept deliberately — the user can still retry it after a reload.
      partialize: (s) => ({
        byChat: Object.fromEntries(
          Object.entries(s.byChat).map(([key, rows]) => [
            key,
            rows.filter((m) => m.status !== 'sending'),
          ]),
        ),
        paging: s.paging,
      }),
    },
  ),
)

/** Read one chat's rows outside React (the reconnect catch-up needs the newest id). */
export function cachedMessages(chatId: Id): ChatMessage[] {
  return useMessageCacheStore.getState().byChat[keyOf(chatId)] ?? []
}

/**
 * The newest real id held for a chat — the `after_id` for the reconnect replay.
 * Optimistic rows are skipped: their ids are negative and locally minted.
 */
export function newestMessageId(chatId: Id): Id | null {
  const rows = cachedMessages(chatId)
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (rows[i].id > 0) return rows[i].id
  }
  return null
}
