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
  /** The message being replied to, per chat. */
  replyTo: Record<string, MessageQuote | null>
  /** The message being edited, per chat — id and the text as it stands. */
  editing: Record<string, { messageId: Id; body: string } | null>
  /** Who is typing, per chat. */
  typing: Record<string, TypingEntry[]>
  /** Presence by `talk_user_id`, for everyone we display. */
  presence: Record<string, Presence>
  /** People I have blocked (account-wide, direct chats). */
  blockedTalkUserIds: Id[]

  setActiveChat: (chatId: Id | null) => void
  setDraft: (chatId: Id, text: string) => void
  clearDraft: (chatId: Id) => void
  setReplyTo: (chatId: Id, quote: MessageQuote | null) => void
  setEditing: (chatId: Id, editing: { messageId: Id; body: string } | null) => void

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
  setBlockedTalkUserIds: (ids: Id[]) => void
  setBlocked: (talkUserId: Id, blocked: boolean) => void

  reset: () => void
}

export const useChatStore = create<ChatState>((set) => ({
  activeChatId: null,
  drafts: {},
  replyTo: {},
  editing: {},
  typing: {},
  presence: {},
  blockedTalkUserIds: [],

  setActiveChat: (chatId) => set({ activeChatId: chatId }),

  setDraft: (chatId, text) =>
    set((s) => ({ drafts: { ...s.drafts, [keyOf(chatId)]: text } })),

  clearDraft: (chatId) =>
    set((s) => {
      const drafts = { ...s.drafts }
      delete drafts[keyOf(chatId)]
      return { drafts }
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
      replyTo: {},
      editing: {},
      typing: {},
      presence: {},
      blockedTalkUserIds: [],
    }),
}))

/** The open chat, read outside React (socket handlers deciding unread). */
export function activeChatId(): Id | null {
  return useChatStore.getState().activeChatId
}
