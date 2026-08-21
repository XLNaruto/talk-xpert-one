import type { Id } from '@/types/api'

/**
 * Every REST path in one place. Feature `api/` files import from here — never
 * inline a string literal at a call site.
 *
 * Mirrors the Talk OpenAPI document (`/talk/docs`). Chat ids are interpolated
 * here rather than at a call site so a renamed segment is a one-line change.
 */
export const ENDPOINTS = {
  /**
   * Public bootstrap read — no auth, mounted at the ROOT, not under `/talk`.
   * Reports `media_path` and the realtime coordinates.
   */
  config: '/config',

  auth: {
    login: '/talk/auth/login',
    /** Rotates: the refresh token you send is dead the moment this answers. */
    refresh: '/talk/auth/refresh',
    logout: '/talk/auth/logout',
    sessions: '/talk/auth/sessions',
    /** Your own `talk_user_id` — the identity every message is compared against. */
    me: '/talk/me',
  },

  /**
   * The directory: every Talk identity of my organisation I am allowed to reach,
   * alphabetically, with `search`/`company_id`/`department_id` + `limit`/`offset`.
   * Read LIVE, so a narrowed grant takes effect at once. Its `talk_user_id` is
   * what `chats.direct` and `chats.group` take.
   */
  contacts: '/talk/contacts',

  chats: {
    list: '/talk/chats',
    /** Idempotent — opening the same direct chat twice returns the same id. */
    direct: '/talk/chats/direct',
    group: '/talk/chats/group',
    /** Hide direct chats from MY list. Groups are refused with a 400. */
    delete: '/talk/chats/delete',
    read: '/talk/chats/read',
    detail: (chatId: Id) => `/talk/chats/${chatId}`,
    /** Rename / description / avatar — owner only. */
    update: (chatId: Id) => `/talk/chats/${chatId}`,
    /** Disband for everyone — owner only. */
    disband: (chatId: Id) => `/talk/chats/${chatId}`,
    /** Pin in MY list only; private to me. Not the same as pinning a message. */
    pin: (chatId: Id) => `/talk/chats/${chatId}/pin`,
    avatarPresign: (chatId: Id) => `/talk/chats/${chatId}/avatar/presign`,
    presence: (chatId: Id) => `/talk/chats/${chatId}/presence`,
    /** HTTP fallback only — prefer the `talk:typing` socket emit. */
    typing: (chatId: Id) => `/talk/chats/${chatId}/typing`,
  },

  members: {
    list: (chatId: Id) => `/talk/chats/${chatId}/members`,
    add: (chatId: Id) => `/talk/chats/${chatId}/members`,
    /**
     * Anyone may leave, the OWNER included — the role is handed on to the
     * longest-standing admin, else the longest-standing member, and the last
     * one out leaves the group owner-less.
     */
    leave: (chatId: Id) => `/talk/chats/${chatId}/leave`,
    remove: (chatId: Id, talkUserId: Id) => `/talk/chats/${chatId}/members/${talkUserId}`,
    /** Silences posting, keeps reading. Announced to the group. Owner or admin. */
    block: (chatId: Id, talkUserId: Id) =>
      `/talk/chats/${chatId}/members/${talkUserId}/block`,
    /**
     * Promote to `admin` or demote to `member` — owner or admin, and never
     * against the owner's row or your own. `owner` is not a valid value: it
     * moves by succession only.
     */
    role: (chatId: Id, talkUserId: Id) =>
      `/talk/chats/${chatId}/members/${talkUserId}/role`,
  },

  messages: {
    list: (chatId: Id) => `/talk/chats/${chatId}/messages`,
    send: (chatId: Id) => `/talk/chats/${chatId}/messages`,
    /** Sender only. On a media message this edits the caption. */
    edit: (chatId: Id, messageId: Id) => `/talk/chats/${chatId}/messages/${messageId}`,
    delete: (chatId: Id) => `/talk/chats/${chatId}/messages/delete`,
    /** Pins for EVERYONE in the chat. Not the same as pinning the chat. */
    pin: (chatId: Id, messageId: Id) => `/talk/chats/${chatId}/messages/${messageId}/pin`,
    pins: (chatId: Id) => `/talk/chats/${chatId}/pins`,
    /** Sender only — 404 on someone else's message. */
    receipts: (chatId: Id, messageId: Id) =>
      `/talk/chats/${chatId}/messages/${messageId}/receipts`,
    media: (chatId: Id) => `/talk/chats/${chatId}/media`,
    /** Attachment upload URL — max 25 MB, size signed into the URL. */
    mediaPresign: (chatId: Id) => `/talk/chats/${chatId}/media/presign`,
    forward: '/talk/messages/forward',
    search: '/talk/messages/search',
  },

  /** MY private, account-wide block list for direct chats. Never announced. */
  blocks: '/talk/blocks',

  presence: '/talk/presence',
} as const
