/**
 * Socket event names, mirrored from the server contract. Never a string literal
 * at a call site.
 *
 * Everything under `talk.` is SERVER → CLIENT. The socket accepts exactly three
 * inbound messages, and they live in `lib/socket-client.ts` because that is the
 * only file allowed to touch socket.io: `talk:join`, `talk:leave`, `talk:typing`.
 * Every other write goes over HTTP.
 */
export const SOCKET_EVENTS = {
  /** `{ chat_id, message }` — the full message object. */
  messageNew: 'talk.message.new',
  /** `{ chat_id, message_id, body, edited_at }` */
  messageEdited: 'talk.message.edited',
  /** `{ chat_id, message_ids }` — delete for EVERYONE only. */
  messageDeleted: 'talk.message.deleted',
  /** `{ chat_id, message_ids, by_talk_user_id }` — turns your own ticks blue. */
  messageRead: 'talk.message.read',
  /** `{ chat_id, message_id, by_talk_user_id }` */
  messagePinned: 'talk.message.pinned',
  messageUnpinned: 'talk.message.unpinned',

  /** `{ chat_id, type, name? }` — you were added to a new chat. */
  chatCreated: 'talk.chat.created',
  /** `{ chat_id, name, description, avatar_url }` */
  chatUpdated: 'talk.chat.updated',
  /** `{ chat_id, by_talk_user_id }` — group disbanded. */
  chatDeleted: 'talk.chat.deleted',

  /** `{ chat_id, talk_user_ids, by_talk_user_id }` */
  memberAdded: 'talk.member.added',
  /** `{ chat_id, talk_user_id }` */
  memberLeft: 'talk.member.left',
  /** `{ chat_id, talk_user_id, by_talk_user_id }` — if it is you, drop the chat. */
  memberRemoved: 'talk.member.removed',
  /** `{ chat_id, talk_user_id, blocked, by_talk_user_id }` */
  memberBlocked: 'talk.member.blocked',

  /** `{ chat_id, talk_user_id }` */
  typingStart: 'talk.typing.start',
  typingStop: 'talk.typing.stop',

  /**
   * `{ talk_user_id, is_online, at }` — NO `chat_id`. The one Talk event
   * broadcast to the whole account, so it must be filtered client-side.
   */
  presence: 'talk.presence',
} as const

/** How many messages one history page pulls. The API caps `limit` at 100. */
export const MESSAGE_PAGE_SIZE = 40

/**
 * In-thread find: how many hits one search page pulls, and how many hits we are
 * willing to hold for prev/next navigation.
 *
 * The bar numbers its hits ("12 / 44"), which only means anything if every hit
 * is actually reachable — so the search pages until it has them all, and the cap
 * is what stops a two-letter query over a five-year thread from paging forever.
 */
export const THREAD_SEARCH_PAGE_SIZE = 50
export const THREAD_SEARCH_HIT_CAP = 300

/**
 * How many history pages the find bar will walk to reach a hit that isn't loaded
 * yet. Messages page by id from the newest end, so an old hit means fetching
 * every page between here and there — bounded, or a hit from last year would
 * quietly pull the whole thread.
 */
export const THREAD_SEARCH_MAX_HISTORY_PAGES = 25

/**
 * The single search param the chat screen uses. It holds the ENCRYPTED id of the
 * open conversation — a record id never appears in a path, and never in the
 * clear. See `use-active-chat-route.ts`.
 */
export const CHAT_URL_PARAM = 'data'

/** How many chats one page of the sidebar pulls. The API caps `limit` at 100. */
export const CHAT_PAGE_SIZE = 30

/**
 * Send `typing: true` at most this often while the composer is active — NEVER
 * per keystroke. Nothing rate-limits this server-side yet.
 */
export const TYPING_THROTTLE_MS = 3500

/**
 * Hide a typing indicator this long after the last signal. Do NOT wait for
 * `talk.typing.stop`: a client that crashes mid-sentence never sends one, so
 * `stop` is an optimisation and this timer is the guarantee.
 */
export const TYPING_EXPIRY_MS = 5000

/**
 * Presence goes stale after ~70 s without a heartbeat, so "offline" can lag by
 * up to a minute when a client dies without closing cleanly.
 */
export const PRESENCE_STALE_MS = 70_000

/**
 * How many files one message may carry. The API takes an array, but each one is
 * a separate presign + PUT, so a picker that accepted forty would stall the send
 * for a minute with no way to tell how far along it is.
 */
export const MAX_ATTACHMENTS = 10

/**
 * How tall the composer grows before it scrolls instead, in pixels. Kept here
 * rather than as a Tailwind class because the auto-resize measures against it.
 */
export const COMPOSER_MAX_HEIGHT_PX = 150

/** Blank group form — react-hook-form defaultValues. */
export const EMPTY_GROUP_FORM = {
  name: '',
  description: '',
  talkUserIds: [] as number[],
}
