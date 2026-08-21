import type { Chat, ChatFilter, UnreadBucket, UnreadSummary } from '../types'

/**
 * Which bucket of the roll-up a filter tab wears.
 *
 * `group` is the CHAT's own kind; the bucket it feeds is `groups`, plural,
 * because it is named after the TAB. This map is the single place that knows the
 * difference, so a summary is never indexed with `chat.type`.
 */
type UnreadBucketKey = keyof Omit<UnreadSummary, 'totalUnread'>

const TAB_BUCKET: Record<ChatFilter, UnreadBucketKey> = {
  all: 'all',
  unread: 'unread',
  direct: 'direct',
  group: 'groups',
}

const EMPTY_BUCKET: UnreadBucket = { chats: 0, messages: 0 }

export const EMPTY_UNREAD_SUMMARY: UnreadSummary = {
  all: EMPTY_BUCKET,
  unread: EMPTY_BUCKET,
  direct: EMPTY_BUCKET,
  groups: EMPTY_BUCKET,
  totalUnread: 0,
}

/**
 * The tab pills, counted HERE from the rows we hold.
 *
 * Every row carries its own `unread_count` and the socket keeps it live — a
 * message arriving bumps it, opening the thread walks it down, leaving a group
 * takes it away — so the badges are a derivation of the list rather than a
 * second copy of the truth pushed alongside it. Nothing to fetch, nothing to
 * reconcile, and the pill can never disagree with the row it sits above.
 *
 * It counts the store's WHOLE inventory, not the visible listing: with the
 * Direct tab picked the listing holds direct chats only, and a Groups pill
 * derived from that would read zero while groups sat unread behind it.
 *
 * Two counts per bucket, answering different questions — `chats` is how many
 * conversations have a badge (what a tab shows), `messages` is how many unread
 * messages they hold between them (the app badge).
 */
export function deriveUnreadSummary(chats: Chat[]): UnreadSummary {
  let allChats = 0
  let allMessages = 0
  let directChats = 0
  let directMessages = 0
  let groupChats = 0
  let groupMessages = 0

  for (const chat of chats) {
    // A chat with nothing unread is in NEITHER count: `chats` counts rows that
    // have a badge, not rows.
    if (chat.unreadCount <= 0) continue
    allChats += 1
    allMessages += chat.unreadCount
    if (chat.type === 'group') {
      groupChats += 1
      groupMessages += chat.unreadCount
    } else {
      directChats += 1
      directMessages += chat.unreadCount
    }
  }

  const all: UnreadBucket = { chats: allChats, messages: allMessages }
  return {
    all,
    // The Unread tab filters to exactly the chats that have unread, so its
    // number cannot be anything other than `all`.
    unread: all,
    direct: { chats: directChats, messages: directMessages },
    groups: { chats: groupChats, messages: groupMessages },
    totalUnread: allMessages,
  }
}

/** The bucket behind one tab. */
export function unreadBucketFor(summary: UnreadSummary, filter: ChatFilter): UnreadBucket {
  return summary[TAB_BUCKET[filter]]
}

/**
 * The number on a tab's pill: how many CONVERSATIONS in that band have unread.
 *
 * Zero means NO PILL — nothing to read is not a number worth drawing, and an
 * empty circle would read as "unknown".
 */
export function tabUnreadCount(summary: UnreadSummary, filter: ChatFilter): number {
  return unreadBucketFor(summary, filter).chats
}

/** A pill is two characters wide at most, so a big number is capped. */
export function formatBadge(count: number): string {
  return count > 99 ? '99+' : String(count)
}
