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
    /**
     * Hide chats from MY list: direct ones, and groups I have already LEFT.
     * A group I am still in is refused with a 400 naming the ids.
     */
    delete: '/talk/chats/delete',
    read: '/talk/chats/read',
    /**
     * Mark UNREAD. An empty body unreads the other person's last message; a
     * `message_id` unreads that message and everything after it.
     */
    unread: (chatId: Id) => `/talk/chats/${chatId}/unread`,
    /** MY mute — `PUT { duration }`, `null` to unmute. Pushes go quiet, nothing else. */
    mute: (chatId: Id) => `/talk/chats/${chatId}/mute`,
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
    /**
     * Take ONE file off a multi-file message — sender only, and always for
     * everyone. `media_ids` are `media[].id` values from that message, never
     * message ids, and there is deliberately no `for_everyone`: hiding a whole
     * message from myself is `messages.delete`, and nothing draws a bubble with
     * a gap in it for one reader.
     */
    mediaDelete: (chatId: Id, messageId: Id) =>
      `/talk/chats/${chatId}/messages/${messageId}/media/delete`,
    /** Pins for EVERYONE in the chat. Not the same as pinning the chat. */
    pin: (chatId: Id, messageId: Id) => `/talk/chats/${chatId}/messages/${messageId}/pin`,
    pins: (chatId: Id) => `/talk/chats/${chatId}/pins`,
    /** Sender only — 404 on someone else's message. */
    receipts: (chatId: Id, messageId: Id) =>
      `/talk/chats/${chatId}/messages/${messageId}/receipts`,
    media: (chatId: Id) => `/talk/chats/${chatId}/media`,
    /** Attachment upload URL — max 25 MB, size signed into the URL. */
    mediaPresign: (chatId: Id) => `/talk/chats/${chatId}/media/presign`,
    /** `PUT { emoji }` — my ONE reaction; `null` removes it. */
    reaction: (chatId: Id, messageId: Id) =>
      `/talk/chats/${chatId}/messages/${messageId}/reaction`,
    /** Who reacted with what — `?emoji=` narrows `items` to one chip's people. */
    reactions: (chatId: Id, messageId: Id) =>
      `/talk/chats/${chatId}/messages/${messageId}/reactions`,
    forward: '/talk/messages/forward',
    search: '/talk/messages/search',
  },

  /**
   * The PUSH DEVICE REGISTRY — where a notification can land, one slot per
   * operating system, exactly like the session slots behind `auth.sessions`.
   *
   * One path, three verbs. `POST` is an UPSERT and is meant to be called on
   * every launch, every token rotation and after every login: it is how the
   * server knows the handset is still alive, so never cache "already
   * registered" and skip it. `DELETE` takes the token in the BODY and is only
   * needed when local state is cleared WITHOUT hitting `auth.logout` — a normal
   * logout drops this platform's registration itself. `GET` lists the handsets,
   * never the tokens.
   */
  devices: '/talk/devices',

  /**
   * Polls. `messageId` is the poll's MESSAGE id — never `poll.id`.
   */
  polls: {
    create: (chatId: Id) => `/talk/chats/${chatId}/polls`,
    vote: (chatId: Id, messageId: Id) =>
      `/talk/chats/${chatId}/messages/${messageId}/poll/vote`,
    close: (chatId: Id, messageId: Id) =>
      `/talk/chats/${chatId}/messages/${messageId}/poll/close`,
    /** Every voter — `?option_id=` narrows `items` for one tab. REST only. */
    votes: (chatId: Id, messageId: Id) =>
      `/talk/chats/${chatId}/messages/${messageId}/poll/votes`,
  },

  /**
   * The card for a link, built ONCE by the server while the sender types and
   * stored with the message. No client ever fetches the linked site itself.
   */
  linkPreview: '/talk/link-preview',

  /**
   * Broadcast lists — one sender, many private 1:1 copies. A list is NOT a chat
   * and never appears in `chats.list`; its recipients cannot tell it exists.
   */
  broadcastLists: {
    list: '/talk/broadcast-lists',
    create: '/talk/broadcast-lists',
    detail: (listId: Id) => `/talk/broadcast-lists/${listId}`,
    update: (listId: Id) => `/talk/broadcast-lists/${listId}`,
    remove: (listId: Id) => `/talk/broadcast-lists/${listId}`,
    /** `PUT { talk_user_ids }` REPLACES the recipients. */
    members: (listId: Id) => `/talk/broadcast-lists/${listId}/members`,
    mediaPresign: (listId: Id) => `/talk/broadcast-lists/${listId}/media/presign`,
    /** `GET` pages newest first by `before_id`; `POST` sends. */
    broadcasts: (listId: Id) => `/talk/broadcast-lists/${listId}/broadcasts`,
  },

  broadcasts: {
    /** Everything I ever broadcast, deleted lists included. */
    list: '/talk/broadcasts',
    /** The delivery report — `?status=` narrows `items`, never `counts`. */
    recipients: (broadcastId: Id) => `/talk/broadcasts/${broadcastId}/recipients`,
  },

  /** MY private, account-wide block list for direct chats. Never announced. */
  blocks: '/talk/blocks',

  presence: '/talk/presence',
} as const
