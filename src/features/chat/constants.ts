/**
 * Socket event names, mirrored from the server contract. Never a string literal
 * at a call site.
 *
 * The naming tells you the direction. **Inbound is `talk:` with a colon** and an
 * imperative — what we SEND. **Outbound is `talk.` with a dot** and a past
 * participle — what we RECEIVE.
 *
 * Every write is now bridged: the gateway holds no database, so an inbound event
 * is a reference to the REST route that owns the operation, called with our own
 * bearer token. The ack carries that route's HTTP status and its response body
 * verbatim, which is why `chat-api.ts` can prefer the socket and fall back to
 * axios without a screen above it knowing which ran.
 */

/**
 * What we SEND. Emitted only through `lib/socket-client.ts`, which owns the ack
 * contract and the single 401 refresh-and-replay.
 *
 * Payloads are ONE FLAT snake_case object — the union of what HTTP puts in the
 * path and in the body — and ids in them must be real integers: `{ chat_id: '42' }`
 * is refused with a 400 before the URL is even built.
 */
export const SOCKET_ACTIONS = {
  /** `{ chat_id, body?, media?, reply_to_message_id?, client_message_id? }` → the full message. */
  messageSend: 'talk:message.send',
  /** `{ chat_id, message_id, body }` → `{ message_id, edited_at }`. */
  messageEdit: 'talk:message.edit',
  /** `{ chat_id, message_ids, for_everyone }` → `{ affected }`. */
  messageDelete: 'talk:message.delete',
  /**
   * `{ chat_id, message_id, media_ids }` → `{ message_id, deleted_media_ids,
   * remaining_media, type, message_deleted }`, byte-identical to the HTTP 200.
   *
   * Takes ONE file off a multi-file message. `media_ids` are `media[].id`
   * values ON THAT MESSAGE — a message id there is a 404 — and there is no
   * `for_everyone`: the sender alone may do it and it always applies to
   * everybody. The last file off a CAPTIONLESS bubble withdraws the whole
   * message, which comes back as `message_deleted` and is announced as
   * `talk.message.deleted` rather than the media event.
   */
  messageMediaDelete: 'talk:message.media.delete',
  /** `{ message_ids, to_chat_ids }` → `{ forwarded }`. One `talk.message.new` per destination. */
  messageForward: 'talk:message.forward',
  /** `{ chat_ids, upto_message_id? }` → `{ affected }`. Takes a LIST — mark-all is one emit. */
  messageRead: 'talk:message.read',
  /**
   * `{ chat_id, message_id, pinned, expires_at?, for_everyone? }` → `{ pinned }`.
   *
   * `pinned` picks the direction and `for_everyone` picks the AUDIENCE, so the
   * pair chooses between four events: the chat-wide `talk.message.pinned` /
   * `unpinned`, and the private `talk.message.self_pinned` / `self_unpinned`.
   * `for_everyone` DEFAULTS TO TRUE server-side — omitting it pins for the whole
   * chat, so the private pin must always send it explicitly.
   */
  messagePin: 'talk:message.pin',

  /** `{ talk_user_id }` → `{ chat_id, created }`. Idempotent — `created` says which. */
  chatCreateDirect: 'talk:chat.create.direct',
  /** `{ name, talk_user_ids, description?, avatar_url?, company_id? }` → `{ chat_id }`. */
  chatCreateGroup: 'talk:chat.create.group',
  /** `{ chat_id, name?, description?, avatar_url? }` → `{ chat_id }`. */
  chatUpdate: 'talk:chat.update',
  /** `{ chat_id }` → `{ deleted }`. Disbands a GROUP for everyone — not "hide from my list". */
  chatDelete: 'talk:chat.delete',

  /** `{ chat_id, talk_user_ids }` → `{ added }`. */
  memberAdd: 'talk:member.add',
  /** `{ chat_id }` → `{ left }`. */
  memberLeave: 'talk:member.leave',
  /** `{ chat_id, talk_user_id }` → `{ removed }`. */
  memberRemove: 'talk:member.remove',
  /** `{ chat_id, talk_user_id, blocked }` → `{ blocked }`. The group block, not the private one. */
  memberBlock: 'talk:member.block',
  /**
   * `{ chat_id, talk_user_id, member_role }` → `{ member_role }`.
   *
   * Promote to `admin` or demote to `member`. `owner` is refused by the schema —
   * it moves by succession only. IDEMPOTENT: setting a role somebody already
   * holds answers 200, writes nothing and announces nothing, so two admins
   * tapping the same item do not put two identical lines in the thread.
   */
  memberRole: 'talk:member.role',
} as const

/**
 * What we RECEIVE. Every payload carries `type` (its own name) and, for anything
 * addressed to a chat room, `chat_id`.
 *
 * Names and photos ride along on purpose, so an event can be drawn before that
 * person's directory entry has ever been read. `photo` is a storage KEY.
 */
export const SOCKET_EVENTS = {
  /** `{ chat_id, message }` — the full message object. */
  messageNew: 'talk.message.new',
  /** `{ chat_id, message_id, body, edited_at }` */
  messageEdited: 'talk.message.edited',
  /** `{ chat_id, message_ids }` — delete for EVERYONE only. */
  messageDeleted: 'talk.message.deleted',
  /**
   * `{ chat_id, message_id, media_ids, type, by_talk_user_id }` — files were
   * taken OFF a message that usually still has content, so it is never routed
   * through the `talk.message.deleted` handler.
   *
   * `type` is the message's type NOW: it is derived from the FIRST file's kind,
   * so removing the first attachment moves the bubble image → video → document.
   * Splice the local array without re-applying it and the client draws a photo
   * frame around a video.
   *
   * Delivered to the whole room INCLUDING the actor's other devices — a removal
   * done on a phone has to disappear on the same person's desktop — so, like
   * every Talk write, the sender sees both the ack and the broadcast. Silent as
   * a push: a removed attachment is state, not news.
   */
  messageMediaDeleted: 'talk.message.media_deleted',
  /**
   * `{ chat_id, message_ids, by_talk_user_id, by_name, by_photo, receipts }` —
   * turns your ticks blue.
   *
   * `receipts` runs parallel to `message_ids`, one row per message, each an item
   * of the receipts endpoint plus the `message_id` it belongs to. They are the
   * READER'S OWN receipts and nobody else's — no member is ever shown who else
   * has read — so in a GROUP one event means "one more person has read this",
   * not "everybody has". The blue tick is the client's sum of them.
   */
  messageRead: 'talk.message.read',
  /** `{ chat_id, message_id, by_talk_user_id, by_name, by_photo }` */
  messagePinned: 'talk.message.pinned',
  messageUnpinned: 'talk.message.unpinned',
  /**
   * `{ type, chat_id, message_id, expires_at }` — MY OWN private bookmark, sent
   * to my other devices and to nobody else. It is not a chat event: no other
   * participant receives it, and it neither sets nor clears the chat-wide pin.
   * `expires_at` is null on the unpin.
   */
  messageSelfPinned: 'talk.message.self_pinned',
  messageSelfUnpinned: 'talk.message.self_unpinned',

  /**
   * `{ chat_id, chat_type, created_by_*, added_by_*?, chat }` — addressed to you
   * PERSONALLY, so it needs no join: the server admits your live sockets to the
   * room in the same call that makes the chat yours.
   *
   * The envelope's `type` is the EVENT NAME and cannot be overwritten by the
   * payload — the chat's own kind is `chat_type` (and `chat.type`). It used to
   * be emitted as `direct` / `group`, which is why no listener ever fired.
   *
   * It covers TWO arrivals, told apart by `added_by_talk_user_id`: a chat
   * created with you in it (absent), and you being added to a group that
   * already existed (present, naming who added you). Both carry the row, so
   * both are inserted the same way.
   *
   * `chat` is the whole row built from YOUR OWN side — byte-identical to what
   * `GET /talk/chats/:id` would answer, `self.member_role` and a direct chat's
   * `counterpart_*` (naming the CREATOR) included — so it is inserted straight
   * into the list. It may be **null** in the rare race where the chat was
   * deleted in the same breath, and then the read is the fallback it always was.
   *
   * Withheld from somebody who has BLOCKED the creator: no live row appears, and
   * the chat instead turns up as an empty thread on their next full list read.
   */
  chatCreated: 'talk.chat.created',
  /** `{ chat_id, name, description, avatar_url }` */
  chatUpdated: 'talk.chat.updated',
  /** `{ chat_id, by_talk_user_id, by_name, by_photo }` — disbanded; eviction follows. */
  chatDeleted: 'talk.chat.deleted',

  /**
   * `{ chat_id, talk_user_ids, members[], by_talk_user_id, by_name, by_photo }`
   *
   * Addressed to the ROOM, so the people just added are precisely the ones who
   * do not receive it — they get a `talk.chat.created` with `added_by_*`
   * instead. It still arrives naming me when I was re-added while holding the
   * row, which is why that case refreshes rather than re-reads.
   */
  memberAdded: 'talk.member.added',
  /** `{ chat_id, talk_user_id, name, photo }` */
  memberLeft: 'talk.member.left',
  /**
   * `{ chat_id, talk_user_id, name, photo, by_* }` — sent TWICE by design: once
   * to the room and once to the person being removed, who is cut off a moment
   * later. Compare `talk_user_id` to your own id before deciding what it means.
   */
  memberRemoved: 'talk.member.removed',
  /** `{ chat_id, talk_user_id, name, photo, blocked, by_* }` */
  memberBlocked: 'talk.member.blocked',
  /**
   * `{ chat_id, talk_user_id, name, photo, member_role, previous_member_role,
   * by_* }` — one event for all three cases, addressed to the ROOM.
   *
   * `previous_member_role` is what tells a promotion from a demotion without a
   * lookup, and `member_role: 'owner'` means SUCCESSION — the owner left and the
   * role was handed on, so `by_*` is the person who LEFT, not a promoter. The
   * person whose role changed is already in the room, so unlike
   * `talk.member.added` there is no separate personal admission to handle.
   */
  memberRoleChanged: 'talk.member.role_changed',

  /** `{ chat_id, talk_user_id, name, photo }` — sender excluded server-side. */
  typingStart: 'talk.typing.start',
  typingStop: 'talk.typing.stop',

  /**
   * `{ talk_user_id, name, photo, is_online, at }` — NO `chat_id`. The one Talk
   * event broadcast to the whole account, so it must be filtered client-side.
   */
  presence: 'talk.presence',

} as const

/**
 * The OPENING read of a thread — `limit: -1`, which is not a page size at all.
 *
 * The server answers it with everything the reader needs to pick up where they
 * left off: the last twenty READ messages for context, plus EVERY unread one
 * however many that is (and a flat hundred when there is nothing unread). So
 * the divider is always in the answer, and there is no "load newer" to build —
 * the thread opens holding its own newest end.
 */
export const MESSAGE_OPENING_LIMIT = -1

/**
 * How many messages one page of OLDER history pulls.
 *
 * Only one direction pages: `before_id`, walking back from the oldest row held.
 * Large on purpose — scrolling up through a long thread should not be a request
 * every screenful, and the rows are cheap next to the round trip.
 */
export const MESSAGE_PAGE_SIZE = 500

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
 * How long a GUARDED event is remembered, so it is applied exactly once.
 *
 * A connected client receives every Talk event TWICE — once on the socket, once
 * as a push — because the push is the offline path and cannot know whether the
 * socket happened to be up. The two land within a second or so of each other,
 * and this only has to outlast that gap.
 *
 * Only `talk.message.new` and `talk.chat.created` are guarded, because only they
 * carry an identity that cannot legitimately repeat. Everything else is applied
 * every time — a pin toggled off and on again is two real events that look
 * identical, and suppressing the second one is how a message quietly stops being
 * pinned. See `lib/talk-event-dedupe.ts`.
 */
export const TALK_EVENT_DEDUPE_TTL_MS = 120_000

/** How many event keys that cache holds before it evicts the expired ones. */
export const TALK_EVENT_DEDUPE_MAX_KEYS = 500

/**
 * The single search param the chat screen uses. It holds the ENCRYPTED id of the
 * open conversation — a record id never appears in a path, and never in the
 * clear. See `use-active-chat-route.ts`.
 */
export const CHAT_URL_PARAM = 'data'

/** How many chats one page of the sidebar pulls. The API caps `limit` at 100. */
export const CHAT_PAGE_SIZE = 30

/**
 * How many pages of the inbox one read will walk.
 *
 * Every row has to be listed AND `talk:join`ed or its messages never arrive
 * live — the server admits you to a room when a chat becomes yours, but it does
 * not push an admission per row of a list read. So the read pages to the end
 * instead of stopping at the first thirty. The cap is what stops an account with
 * thousands of conversations from opening with a burst of requests; rows past it
 * still work, they just wait for the next read.
 */
export const CHAT_LIST_MAX_PAGES = 10

/**
 * How long to leave a chat alone after a read of it was REFUSED.
 *
 * The gateway now admits your sockets to rooms you never joined, so messages
 * arrive for chats the client has never listed — one past the inbox pages, one
 * created while you were offline, one you had deleted for yourself. Each is read
 * and inserted. A read that fails (removed from the group, say) must not be
 * retried once per message in it.
 */
export const ADOPT_RETRY_COOLDOWN_MS = 60_000

/**
 * How many pins one page of the pinned-messages sheet pulls. The API caps
 * `limit` at 100, and each row carries a whole message, so this stays modest.
 */
export const PIN_PAGE_SIZE = 20

/**
 * How many people one page of the directory pulls. The API caps `limit` at 100.
 * Deliberately small: the picker is a search box, not a phone book, and a wide
 * grant can reach thousands of colleagues.
 */
export const CONTACT_PAGE_SIZE = 30

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
 * How many files one per-file delete may name. The API refuses 0 and anything
 * over this with a 400, so the grid's selection is capped rather than the
 * request being sent to be refused.
 */
export const MAX_MEDIA_DELETE = 100

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

/**
 * How long to let the virtualised list settle after opening a thread before any
 * read receipt is sent.
 *
 * Virtuoso reports several intermediate ranges while it works its way from the
 * bottom to `initialTopMostItemIndex`, and each one looks exactly like the user
 * having read those messages. Marking read off the first range would clear the
 * unread frontier the moment the chat opened — which is the one thing the unread
 * divider exists to prevent.
 */
export const THREAD_READ_SETTLE_MS = 600

/**
 * How close to the end counts as "at the bottom", in pixels.
 *
 * The threshold is what decides whether an arriving message scrolls the view or
 * only bumps the badge, so it is deliberately tight: a user who has scrolled up
 * even slightly is reading history and must not be yanked away from it.
 */
export const THREAD_AT_BOTTOM_THRESHOLD_PX = 24

/**
 * How long a freshly-opened chat keeps re-asserting the bottom of the thread.
 *
 * Opening is not one event but several: cached rows paint, a fresh page
 * replaces them, row heights are measured for the first time, and media decodes
 * — each one moves the end of the list after the initial scroll has finished.
 * The window closes the moment the reader scrolls away themselves.
 */
export const THREAD_OPEN_SETTLE_MS = 2500

/**
 * How long the thread is held off its own corrections after a jump has landed.
 *
 * The landing is not one scroll: `scrollToIndex` works off estimated heights, so
 * the rows between here and the target are measured for the first time as they
 * mount and each measurement moves the target again. The list re-asserts through
 * that, and until it has finished, "the reader is at the bottom" is still the
 * wrong conclusion to draw — so the hold outlives the scroll rather than ending
 * with the call that started it.
 *
 * Comfortably longer than the retry window below, so the hold is released after
 * the last correction rather than during it.
 */
export const THREAD_JUMP_SETTLE_MS = 1400

/**
 * How often a jump re-checks that its message is on screen, and how long it
 * keeps checking once the row exists.
 *
 * The row may not exist on the first pass at all — the page holding it can land
 * a render later — so the ticker waits for it rather than giving up, and only
 * starts spending its window once there is something to centre.
 */
export const THREAD_JUMP_RETRY_MS = 90
export const THREAD_JUMP_CENTRE_WINDOW_MS = 1000

/**
 * The longest a jump will wait for its message to be drawn before giving up.
 *
 * The history walk has already put it in the cache by the time the scroll is
 * asked for, so this is only a backstop against a ticker with nothing to find.
 */
export const THREAD_JUMP_WAIT_CAP_MS = 8000

/**
 * How long a jumped-to message stays banded.
 *
 * Long enough to catch the eye after the scroll settles, short enough that the
 * band is gone by the time the reader starts reading around it.
 */
export const THREAD_JUMP_HIGHLIGHT_MS = 2200

/**
 * The index Virtuoso gives the newest-loaded page's first row when a thread
 * opens, decremented by one per message prepended above it.
 *
 * Virtuoso needs this to know that a page landed at the TOP rather than the
 * bottom: without it a prepend leaves the scroller where it was, so the reader
 * is thrown up into the page they just pulled — and `startReached` de-dupes on
 * the first rendered item's index, which never moves off 0, so it fires exactly
 * once per thread and older-message paging dies after one page.
 *
 * A large base because it may only ever COUNT DOWN, and it must stay positive.
 */
export const THREAD_FIRST_ITEM_INDEX_BASE = 1_000_000

/**
 * How long history paging rests after a page lands.
 *
 * One flick to the top of a thread used to pull SEVEN pages back to back: each
 * prepend puts the reader at the top again, `startReached` fires again, and the
 * next request goes out before Virtuoso has finished compensating the scroll for
 * the last one — which is what made the list blank and jump. A short rest lets
 * one page settle and the reader land in it before the next is asked for; if
 * they are still at the top when it expires, the next page is fetched normally.
 */
export const THREAD_HISTORY_PAGE_COOLDOWN_MS = 400

/**
 * How long the scroll corrections stand down after a page prepends.
 *
 * A prepend is the ONE height change this hook must not react to, because
 * Virtuoso is already reacting to it. Told that N rows arrived above the top row
 * (`firstItemIndex`), it holds the view still by translating the list and then
 * scrolling by the height of those rows — a compensation spread over two
 * animation frames, during which the scroller reports a position several
 * thousand pixels from the end.
 *
 * Every guard in `use-thread-scroll.ts` reads that as "the view fell off the
 * end" and scrolls back down, landing between the two halves of the
 * compensation. Virtuoso then completes it from the position we moved it to, so
 * the view is thrown to the top of the list; the next correction hauls it back;
 * and each height that settles afterwards starts the exchange again. Measured on
 * a 149-row page: four round trips of about 9,400 px each, inside 150 ms.
 *
 * So the corrections wait. Longer than the two frames the compensation itself
 * takes, because the prepended rows are measured for the first time just after
 * it, and shorter than `THREAD_HISTORY_PAGE_COOLDOWN_MS` so the hold has always
 * expired before the next page can be asked for.
 */
export const THREAD_PREPEND_HOLD_MS = 250

/**
 * How far outside the viewport Virtuoso keeps rows mounted, in pixels.
 *
 * Virtuoso mounts only what is visible, so a fast scroll outruns it and shows
 * bare background until the next render catches up. Rendering slack in each
 * direction covers the gap; more than that costs mount time on every page of
 * history for rows nobody is going to see.
 *
 * Two screenfuls rather than one, and the second one is bought for the MEDIA.
 * An attachment whose size the API did not name can only be measured by
 * decoding it, and the tile is what starts that decode — so the row has to be
 * mounted for a while BEFORE it is looked at, or the frame arrives, the box
 * changes shape to fit it, and the reader watches the thread twitch under a
 * photo they were already reading. Mounting a screenful earlier gives the bytes
 * that head start; `naturalSizes` in `message-media.tsx` then keeps the answer
 * for every later visit.
 */
export const THREAD_OVERSCAN_PX = 1200

/**
 * How close to the end counts as landed, when CORRECTING the scroll.
 *
 * Deliberately much tighter than `THREAD_AT_BOTTOM_THRESHOLD_PX`, which answers
 * a different question. That one asks "is the reader caught up", where a couple
 * of dozen pixels of slack is right. This one asks "has the opening scroll
 * arrived", and the same slack there leaves the newest bubble clipped by the
 * composer. It only has to absorb the sub-pixel remainder of a fractional
 * `scrollTop` against a rounded `scrollHeight`.
 */
export const THREAD_AT_END_TOLERANCE_PX = 2
