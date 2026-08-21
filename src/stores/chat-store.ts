import { create } from 'zustand'
import { keyOf, type Id } from '@/types/api'
import type { MessageQuote, Presence } from '@/features/chat/types'

/**
 * Client/UI state for the chat screen: which chat is open, what is half-typed,
 * who is typing, who is online.
 *
 * The open chat lives here, not in the path — no `/chat/:chatId`, because a
 * record id never appears in a URL segment. `use-active-chat-route.ts` mirrors
 * it into an encrypted `?data=` token and restores it on a refresh; this store
 * stays the single source of truth that everything else reads.
 *
 * Nothing in here is persisted: a draft is worth keeping across a thread switch,
 * not across a browser restart, and typing and presence are ephemeral by
 * definition.
 */

/** Who is typing, and when their signal expires. */
interface TypingEntry {
  talkUserId: Id
  /** Epoch ms. A signal is ignored once past this — see `TYPING_EXPIRY_MS`. */
  expiresAt: number
}

interface ChatState {
  activeChatId: Id | null
  /** Unsent text per chat, so switching threads doesn't lose a draft. */
  drafts: Record<string, string>
  /**
   * Files picked or dropped but not yet sent, per chat.
   *
   * Here rather than in the composer's `useState` because the drop target is the
   * WHOLE thread pane — `chat-area.tsx` accepts the drop, `message-input.tsx`
   * draws the strip, and neither can reach the other's local state. Nothing in
   * this store is persisted, which is what makes holding `File` objects safe.
   */
  attachments: Record<string, File[]>
  /** The message being replied to, per chat. */
  replyTo: Record<string, MessageQuote | null>
  /** The message being edited, per chat — id, the text as it stands, and
   *  whether that text is a CAPTION on media, which may be cleared. */
  editing: Record<string, { messageId: Id; body: string; hasMedia: boolean } | null>
  /** Who is typing, per chat. */
  typing: Record<string, TypingEntry[]>
  /** Presence by `talk_user_id`, for everyone we display. */
  presence: Record<string, Presence>
  /** People I have blocked (account-wide, direct chats). */
  blockedTalkUserIds: Id[]

  /**
   * Cache-invalidation ticks, per chat, for the two lists a socket event
   * changes but cannot itself carry: the pin bar and the member sheet.
   *
   * `talk.message.pinned` says a pin happened, not what the bar should now read
   * — pins EXPIRE at read time, so only `GET /talk/chats/:id/pins` knows. The
   * member events say who joined or left, not their role or block flag, which
   * the server owns. Both lists live in a hook's `useState` and are unreachable
   * from a socket handler, so the handler bumps a number and the hook re-reads.
   *
   * The bump is skipped for a change I MADE — my own write already re-read —
   * so each change costs exactly one request, on the side that caused it.
   */
  pinRevision: Record<string, number>
  memberRevision: Record<string, number>
  /**
   * Bumped when somebody reads in this chat, so an OPEN message-info sheet
   * re-reads. The event's receipts are the reader's own, and the sheet lists
   * every recipient including those who have not read — only the endpoint knows
   * that, so this asks for it rather than patching a partial answer in.
   */
  receiptRevision: Record<string, number>
  /**
   * Whether the OPEN thread is showing its newest message.
   *
   * Owned by `use-thread-scroll`, read by the socket handler. A message is read
   * when it lands in the VIEWPORT — so an arrival in the chat you are looking at
   * counts as unread all the same when you are up in history, and the row's
   * badge has to say so at the moment it arrives rather than being corrected a
   * beat later.
   */
  isThreadAtBottom: boolean

  setActiveChat: (chatId: Id | null) => void
  setDraft: (chatId: Id, text: string) => void
  clearDraft: (chatId: Id) => void
  setAttachments: (chatId: Id, files: File[]) => void
  clearAttachments: (chatId: Id) => void
  setReplyTo: (chatId: Id, quote: MessageQuote | null) => void
  setEditing: (
    chatId: Id,
    editing: { messageId: Id; body: string; hasMedia: boolean } | null,
  ) => void

  /** `talk.typing.start` — records the signal with a fresh expiry. */
  startTyping: (chatId: Id, talkUserId: Id, expiresAt: number) => void
  /** `talk.typing.stop` — an optimisation; the expiry is the guarantee. */
  stopTyping: (chatId: Id, talkUserId: Id) => void
  /** Drop expired signals. Called on a tick, so a crashed sender's clears. */
  pruneTyping: (now: number) => void
  /** Every indicator is stale after a reconnect, and on closing a chat. */
  clearTyping: (chatId?: Id) => void

  /** Merge presence, whether from `GET /talk/presence` or `talk.presence`. */
  applyPresence: (entries: Presence[]) => void
  /** `talk.message.pinned` / `talk.message.unpinned` from somebody else. */
  bumpPins: (chatId: Id) => void
  /** `talk.member.*` from somebody else. */
  bumpMembers: (chatId: Id) => void
  /** `talk.message.read` from somebody else. */
  bumpReceipts: (chatId: Id) => void
  setThreadAtBottom: (atBottom: boolean) => void
  setBlockedTalkUserIds: (ids: Id[]) => void
  setBlocked: (talkUserId: Id, blocked: boolean) => void

  reset: () => void
}

export const useChatStore = create<ChatState>((set) => ({
  activeChatId: null,
  drafts: {},
  attachments: {},
  replyTo: {},
  editing: {},
  typing: {},
  presence: {},
  blockedTalkUserIds: [],
  pinRevision: {},
  memberRevision: {},
  receiptRevision: {},
  isThreadAtBottom: true,

  setActiveChat: (chatId) => set({ activeChatId: chatId }),

  setDraft: (chatId, text) =>
    set((s) => ({ drafts: { ...s.drafts, [keyOf(chatId)]: text } })),

  clearDraft: (chatId) =>
    set((s) => {
      const drafts = { ...s.drafts }
      delete drafts[keyOf(chatId)]
      return { drafts }
    }),

  setAttachments: (chatId, files) =>
    set((s) => ({ attachments: { ...s.attachments, [keyOf(chatId)]: files } })),

  clearAttachments: (chatId) =>
    set((s) => {
      const attachments = { ...s.attachments }
      delete attachments[keyOf(chatId)]
      return { attachments }
    }),

  setReplyTo: (chatId, quote) =>
    set((s) => ({ replyTo: { ...s.replyTo, [keyOf(chatId)]: quote } })),

  setEditing: (chatId, editing) =>
    set((s) => ({ editing: { ...s.editing, [keyOf(chatId)]: editing } })),

  startTyping: (chatId, talkUserId, expiresAt) =>
    set((s) => {
      const key = keyOf(chatId)
      const others = (s.typing[key] ?? []).filter((t) => t.talkUserId !== talkUserId)
      return { typing: { ...s.typing, [key]: [...others, { talkUserId, expiresAt }] } }
    }),

  stopTyping: (chatId, talkUserId) =>
    set((s) => {
      const key = keyOf(chatId)
      const held = s.typing[key]
      if (!held?.length) return {}
      return {
        typing: { ...s.typing, [key]: held.filter((t) => t.talkUserId !== talkUserId) },
      }
    }),

  pruneTyping: (now) =>
    set((s) => {
      let changed = false
      const typing: Record<string, TypingEntry[]> = {}
      for (const [key, entries] of Object.entries(s.typing)) {
        const live = entries.filter((t) => t.expiresAt > now)
        if (live.length === entries.length) {
          // Keep the SAME array when nothing expired. This runs on a one-second
          // tick and every sidebar row subscribes to its own slice, so handing
          // back a fresh array per chat would re-render the whole list each tick.
          typing[key] = entries
        } else {
          typing[key] = live
          changed = true
        }
      }
      return changed ? { typing } : {}
    }),

  clearTyping: (chatId) =>
    set((s) =>
      chatId == null
        ? { typing: {} }
        : { typing: { ...s.typing, [keyOf(chatId)]: [] } },
    ),

  applyPresence: (entries) =>
    set((s) => {
      if (entries.length === 0) return {}
      const presence = { ...s.presence }
      for (const entry of entries) {
        const key = keyOf(entry.talkUserId)
        const held = presence[key]
        // `talk.presence` carries no name and no photo — only an id and a flag —
        // so an event must never blank what the snapshot read told us.
        presence[key] = {
          ...entry,
          name: entry.name ?? held?.name ?? null,
          photo: entry.photo ?? held?.photo ?? null,
        }
      }
      return { presence }
    }),

  bumpPins: (chatId) =>
    set((s) => {
      const key = keyOf(chatId)
      return { pinRevision: { ...s.pinRevision, [key]: (s.pinRevision[key] ?? 0) + 1 } }
    }),

  bumpMembers: (chatId) =>
    set((s) => {
      const key = keyOf(chatId)
      return {
        memberRevision: { ...s.memberRevision, [key]: (s.memberRevision[key] ?? 0) + 1 },
      }
    }),

  bumpReceipts: (chatId) =>
    set((s) => {
      const key = keyOf(chatId)
      return {
        receiptRevision: { ...s.receiptRevision, [key]: (s.receiptRevision[key] ?? 0) + 1 },
      }
    }),

  setThreadAtBottom: (isThreadAtBottom) =>
    set((s) => (s.isThreadAtBottom === isThreadAtBottom ? {} : { isThreadAtBottom })),

  setBlockedTalkUserIds: (blockedTalkUserIds) => set({ blockedTalkUserIds }),

  setBlocked: (talkUserId, blocked) =>
    set((s) => ({
      blockedTalkUserIds: blocked
        ? [...new Set([...s.blockedTalkUserIds, talkUserId])]
        : s.blockedTalkUserIds.filter((id) => id !== talkUserId),
    })),

  reset: () =>
    set({
      activeChatId: null,
      drafts: {},
      attachments: {},
      replyTo: {},
      editing: {},
      typing: {},
      presence: {},
      blockedTalkUserIds: [],
      pinRevision: {},
      memberRevision: {},
      receiptRevision: {},
      isThreadAtBottom: true,
    }),
}))

/** The open chat, read outside React (socket handlers deciding unread). */
export function activeChatId(): Id | null {
  return useChatStore.getState().activeChatId
}
