import { create } from 'zustand'
import { keyOf, type Id } from '@/types/api'
import type { ChatMessage } from '@/features/chat/types'

/**
 * In-memory message cache — Talk's answer to a server-state library.
 *
 * The REST API is the source of truth and the socket is an accelerator, so both
 * feed this one store: a page of history merges in, a `talk.message.new` merges
 * in, and components only ever read the result. Nothing here is persisted: a
 * reload starts empty and `useMessages` re-reads the newest page from the API,
 * which is also the read that re-issues the room grant.
 *
 * Because it lives only for the session, it is bounded: `retain` keeps the
 * `CACHED_CHATS` most recently opened conversations and drops the rest outright
 * — rows AND paging, so re-opening one reads a clean first page rather than
 * paging on from a cursor whose rows are gone.
 *
 * Everything here merges by `id`. That is not an optimisation — the gateway
 * delivers events to the conversation's room and OUR OWN sockets are in it, so
 * we receive an echo of everything we send. Without id-merging every message we
 * sent would render twice.
 *
 * The echo of a send STILL IN FLIGHT is the hard case, and `adopt` below is the
 * answer: the API does not echo `client_message_id` back, so the optimistic
 * bubble (a local negative id) and the server's row (a real id) cannot be
 * matched by key. The echo routinely beats our own HTTP response, so without
 * that step the sender watches their message appear twice — once with the
 * pending clock, once with a tick — until `reconcile` collapses it.
 */

/**
 * How many conversations' history stays in memory. The rest are evicted on the
 * next open — re-opening re-reads, which the thread does anyway.
 */
const CACHED_CHATS = 10

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
  /** Chat keys, most recently opened first — the eviction order. */
  recent: string[]

  /**
   * Mark a chat as the one being read and evict everything past
   * `CACHED_CHATS`. Called when a thread opens, before its first page lands.
   */
  retain: (chatId: Id) => void

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
  /**
   * Flip a send to `failed`, keeping the bubble so nothing the user typed is
   * lost. `failure` carries WHY, and whether a retry is worth offering — a
   * refusal (403/404/400) is final and the bubble says so instead of showing a
   * button that can only fail again.
   */
  markFailed: (
    chatId: Id,
    clientMessageId: string,
    failure?: { reason: string; canRetry: boolean },
  ) => void
  /**
   * Put a failed bubble back to `sending` for a retry.
   *
   * The row is REUSED rather than replaced: a retry replays the same
   * `client_message_id`, which is what makes the send idempotent, so inserting a
   * second placeholder would leave the reader looking at two copies of one
   * message — and only one of them would ever reconcile.
   */
  markSending: (chatId: Id, clientMessageId: string) => void
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
  /**
   * `talk.message.read` — turn my own ticks blue.
   *
   * `readerTalkUserId` is who did the reading, and `readerTotal` is how many
   * people have to read before the message is read by ALL — 1 in a direct chat,
   * everyone but me in a group. The event reports the READER's own receipts and
   * nobody else's, so a group message goes blue only once its readers add up.
   */
  applyRead: (
    chatId: Id,
    messageIds: Id[],
    /**
     * `readerTotal` is how many people must read before the double tick is
     * earned — every member but me in a group, one in a direct chat, and NULL
     * when the chat's size is not known here. Null never concludes: the count
     * rises and the flag is left to the server's `is_read_by_all`.
     */
    by?: { readerTalkUserId?: Id | null; readerTotal?: number | null },
  ) => void
  /**
   * The two pins are separate flags on the same row: `forEveryone` writes the
   * chat-wide `isPinned`, and its opposite writes MY private `isPinnedForMe`.
   * They are independent in both directions, so one never touches the other.
   */
  applyPinned: (chatId: Id, messageId: Id, pinned: boolean, forEveryone?: boolean) => void

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
    map.set(message.id, held ? { ...held, ...message } : adopt(map, message))
  }
  return [...map.values()].sort(byOldestFirst)
}

/**
 * Land a server row on the optimistic bubble it is the saved copy OF, if there
 * is one, instead of beside it.
 *
 * `client_message_id` goes UP with a send and makes it idempotent, but it does
 * not come back down: neither the response nor the `talk.message.new` echo
 * carries it. So the only handle left is the send itself — a row of mine, still
 * marked `sending`, holding the same text and the same number of attachments.
 * The oldest such row wins, because the server saves sends in the order it
 * received them, which is the order they were placed here.
 *
 * The placeholder is REMOVED and its `clientMessageId` moves onto the real row,
 * so the `reconcile` that follows still finds its own bubble and replaces the
 * row it already owns rather than adding a third.
 */
function adopt(map: Map<Id, ChatMessage>, message: ChatMessage): ChatMessage {
  // A negative id is itself an optimistic row being placed — nothing to adopt.
  if (message.id < 0) return message

  for (const held of map.values()) {
    if (held.id >= 0 || held.status !== 'sending' || !held.clientMessageId) continue
    if (held.senderTalkUserId !== message.senderTalkUserId) continue
    if ((held.body ?? '') !== (message.body ?? '')) continue
    if (held.media.length !== message.media.length) continue
    if ((held.replyToMessageId ?? null) !== (message.replyToMessageId ?? null)) continue

    map.delete(held.id)
    // NOT revoked here. The tile is still showing this blob and will go on
    // showing it until the stored copy has decoded — revoking under a picture
    // that is mid-swap is how the photo blinked out. The send path releases it
    // once the replacement can be drawn; this is the backstop for the socket
    // echo, which arrives with no idea what the replacement looks like.
    releaseLater(held)
    return { ...message, clientMessageId: held.clientMessageId, status: 'sent' }
  }

  return message
}

/**
 * The placeholder's `blob:` previews die with it — but not this instant.
 *
 * They are only ever minted for an optimistic row, and the adopted server row
 * draws from storage instead. The delay is the width of the swap: long enough
 * that the stored copy has had every chance to load behind the blob still on
 * screen, short enough that a tab does not sit on a 25 MB file. Revoking twice
 * is harmless, so the send path's own release can still beat this one.
 */
const BLOB_RELEASE_DELAY_MS = 30_000

function releaseLater(message: ChatMessage): void {
  const blobs = message.media
    .map((item) => item.fileUrl)
    .filter((url) => url.startsWith('blob:'))
  if (blobs.length === 0) return
  setTimeout(() => blobs.forEach((url) => URL.revokeObjectURL(url)), BLOB_RELEASE_DELAY_MS)
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

export const useMessageCacheStore = create<MessageCacheState>()((set) => ({
  byChat: {},
  paging: {},
  recent: [],

  retain: (chatId) =>
    set((s) => {
      const key = keyOf(chatId)
      const recent = [key, ...s.recent.filter((k) => k !== key)]
      if (recent.length <= CACHED_CHATS) return { recent }

      const byChat = { ...s.byChat }
      const paging = { ...s.paging }
      for (const evicted of recent.slice(CACHED_CHATS)) {
        delete byChat[evicted]
        delete paging[evicted]
      }
      return { byChat, paging, recent: recent.slice(0, CACHED_CHATS) }
    }),

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

  markFailed: (chatId, clientMessageId, failure) =>
    set((s) =>
      patchChat(s, chatId, (held) =>
        mapWhere(
          held,
          (m) => m.clientMessageId === clientMessageId,
          (m) => ({
            ...m,
            status: 'failed',
            uploadProgress: undefined,
            failureReason: failure?.reason,
            canRetry: failure?.canRetry ?? true,
          }),
        ),
      ),
    ),

  markSending: (chatId, clientMessageId) =>
    set((s) =>
      patchChat(s, chatId, (held) =>
        mapWhere(
          held,
          (m) => m.clientMessageId === clientMessageId,
          // The previous attempt's verdict goes with it — a retry that fails
          // again writes a fresh one, and a retry in flight must not still be
          // showing the last refusal.
          (m) => ({
            ...m,
            status: 'sending',
            uploadProgress: undefined,
            failureReason: undefined,
            canRetry: undefined,
          }),
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

  applyRead: (chatId, messageIds, by = {}) =>
    set((s) => {
      const ids = new Set(messageIds)
      const { readerTalkUserId = null, readerTotal = null } = by
      return patchChat(s, chatId, (held) =>
        mapWhere(
          held,
          (m) => ids.has(m.id),
          (m) => {
            const readers =
              readerTalkUserId === null
                ? (m.readerIds ?? [])
                : [...new Set([...(m.readerIds ?? []), readerTalkUserId])]
            // Without a named reader there is nothing to count, so one read is
            // taken at face value — which is what a direct chat means anyway.
            const readCount = Math.max(m.readCount, readers.length, 1)
            return {
              ...m,
              readerIds: readers,
              isReadByAll:
                m.isReadByAll ||
                (readerTotal !== null && readCount >= Math.max(1, readerTotal)),
              readCount,
              status: m.status === 'sending' ? m.status : 'read',
            }
          },
        ),
      )
    }),

  applyPinned: (chatId, messageId, pinned, forEveryone = true) =>
    set((s) =>
      patchChat(s, chatId, (held) =>
        mapWhere(
          held,
          (m) => m.id === messageId,
          (m) => (forEveryone ? { ...m, isPinned: pinned } : { ...m, isPinnedForMe: pinned }),
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
      return { byChat, paging, recent: s.recent.filter((k) => k !== key) }
    }),

  clear: () => set({ byChat: {}, paging: {}, recent: [] }),
}))

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

/**
 * The oldest real id held for a chat — the `before_id` for the next page up.
 *
 * Read from the ROWS rather than from the last page's `oldestId`, so the cursor
 * is always the topmost message actually on screen. The two agree whenever every
 * row arrived through `setPage`, but a jump seek or a catch-up merges rows in by
 * other routes, and a cursor that lags the list re-requests a page already held
 * instead of walking further back.
 */
export function oldestMessageId(chatId: Id): Id | null {
  for (const row of cachedMessages(chatId)) {
    if (row.id > 0) return row.id
  }
  return null
}
