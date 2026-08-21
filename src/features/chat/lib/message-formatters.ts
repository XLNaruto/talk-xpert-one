import { format, isThisYear, isToday, isYesterday } from 'date-fns'
import type { ChatMessage, Presence } from '../types'

/** Bubble timestamp — time only, since the day divider carries the date. */
export function formatMessageTime(iso: string): string {
  return format(new Date(iso), 'h:mm a')
}

/** Chat-list timestamp — the coarsest label that stays unambiguous. */
export function formatChatTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (isToday(date)) return format(date, 'h:mm a')
  if (isYesterday(date)) return 'Yesterday'
  return isThisYear(date) ? format(date, 'd MMM') : format(date, 'd MMM yyyy')
}

/** Date + time on one line — search hits and delivery receipts. */
export function formatDateTime(iso: string): string {
  return format(new Date(iso), 'd MMM, h:mm a')
}

/** Day divider label above the first message of each calendar day. */
export function formatDayDivider(iso: string): string {
  const date = new Date(iso)
  if (isToday(date)) return 'Today'
  if (isYesterday(date)) return 'Yesterday'
  return format(date, 'EEEE, d MMMM')
}

/** "Last seen" line under a direct chat's name. */
export function formatLastSeen(presence: Presence | undefined): string {
  if (!presence) return ''
  if (presence.isOnline) return 'Online'
  if (!presence.lastSeenAt) return 'Offline'
  const date = new Date(presence.lastSeenAt)
  if (isToday(date)) return `Last seen at ${format(date, 'h:mm a')}`
  if (isYesterday(date)) return `Last seen yesterday`
  return `Last seen ${format(date, 'd MMM')}`
}

/** How long a speaker may pause and still be answering their own last line. */
const GROUP_GAP_MS = 5 * 60 * 1000

/**
 * True when this message opens a new visual run — it gets an author name in a
 * group, the tail on its bubble, and the extra spacing above.
 *
 * Four things break a run, and each one is a case where folding the message
 * into the block above it would say something untrue:
 *
 * - a **system** message belongs to nobody, so it would be attributed to the
 *   previous speaker;
 * - a **different sender**, which is the obvious one;
 * - a gap longer than `GROUP_GAP_MS` — past a few minutes it is a new thought,
 *   not the same breath;
 * - a **day boundary**, because a day divider is about to be drawn between the
 *   two. Without this the first message after "Today" arrived tucked under the
 *   divider with no avatar and no name, reading as a continuation of a run that
 *   the divider had already visibly ended.
 */
export function startsNewGroup(
  message: ChatMessage,
  previous: ChatMessage | undefined,
): boolean {
  if (!previous) return true
  if (message.type === 'system' || previous.type === 'system') return true
  if (previous.senderTalkUserId !== message.senderTalkUserId) return true
  if (startsNewDay(message, previous)) return true
  return stampOf(message).time - stampOf(previous).time > GROUP_GAP_MS
}

/** True when a day divider belongs above this message. */
export function startsNewDay(
  message: ChatMessage,
  previous: ChatMessage | undefined,
): boolean {
  if (!previous) return true
  return stampOf(previous).day !== stampOf(message).day
}

/**
 * One message's timestamp, parsed ONCE for as long as the row lives.
 *
 * The two tests above are asked for every row of the thread and for its
 * neighbour, so a thread of nine hundred messages used to parse several thousand
 * dates — and call `toDateString()`, which formats to a locale string only to
 * throw it away — every time a single socket event touched the cache. That was
 * the `'message' handler took 381ms` in the console: one arrival re-derived the
 * whole log, and the main thread was not painting while it did.
 *
 * A `WeakMap` on the message OBJECT is the right cache for it: rows here are
 * immutable, so a message that has been edited is a different object and gets a
 * fresh entry, and a row that falls out of the cache takes its entry with it
 * without anything having to clear up.
 */
const stamps = new WeakMap<ChatMessage, { day: number; time: number }>()

function stampOf(message: ChatMessage): { day: number; time: number } {
  const held = stamps.get(message)
  if (held) return held
  const at = new Date(message.createdAt)
  const stamp = {
    // A LOCAL calendar day as one comparable number — the divider has to break
    // where the reader's day breaks, not where UTC's does, so this cannot be
    // derived from the ISO string by slicing it.
    day: at.getFullYear() * 10_000 + at.getMonth() * 100 + at.getDate(),
    time: at.getTime(),
  }
  stamps.set(message, stamp)
  return stamp
}

/**
 * "Ana is typing…", and the plural forms.
 *
 * Named rather than counted up to two people, because in a two-person chat "1
 * person is typing" is absurd and in a group the names are the useful part.
 *
 * Takes names, not ids: `talk.typing.*` carries only a `talk_user_id`, so the
 * lookup happens in `useTypingNames` and this stays pure.
 */
export function formatTypingLine(names: string[], isDirect = false): string {
  if (names.length === 0) return ''
  // In a DIRECT chat there is only one other person and their name is already
  // the title of the row, the header and the thread — repeating it in the line
  // below says nothing. A group has to name who it is.
  if (isDirect) return 'typing…'
  if (names.length === 1) return `${names[0]} is typing…`
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`
  return `${names[0]}, ${names[1]} and ${names.length - 2} more are typing…`
}

/**
 * How many emoji a message may hold and still be drawn large. Past this it is a
 * sentence written in emoji, and a sentence belongs in a bubble at reading size.
 */
const JUMBO_EMOJI_LIMIT = 3

/**
 * Everything that may appear in a message that is "only emoji".
 *
 * Deliberately built from `Extended_Pictographic` rather than `Emoji`: the
 * latter also matches the ASCII digits, `#` and `*`, which would quietly promote
 * "123" to a giant three-character message. The rest are the pieces emoji are
 * assembled FROM — the zero-width joiner in 👨‍👩‍👧, the variation selector that
 * turns a glyph into its colour form, the skin-tone modifiers, the keycap mark,
 * and the regional indicators that pair up into a flag.
 */
const EMOJI_ONLY =
  /^(?:\s|\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|\u200D|\uFE0F|\u20E3)+$/u

/** At least one actual picture, so whitespace alone never qualifies. */
const HAS_PICTOGRAPH = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u

/**
 * One segmenter for the whole app. Constructing one is expensive enough to show
 * up when every bubble in a scrolling thread builds its own.
 */
const graphemes =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null

/**
 * How many emoji a body is, if that is all it is — otherwise null.
 *
 * Counted in GRAPHEME CLUSTERS, not code points: 👍🏽 is one emoji made of two
 * code points and 👨‍👩‍👧‍👦 is one made of seven, so `body.length` would call a
 * single family a seven-emoji sentence and shrink it back into a bubble.
 */
export function countJumboEmoji(body: string | null): number | null {
  if (!body) return null
  const text = body.trim()
  if (!text || !EMOJI_ONLY.test(text) || !HAS_PICTOGRAPH.test(text)) return null

  const withoutSpace = text.replace(/\s+/gu, '')
  const count = graphemes
    ? [...graphemes.segment(withoutSpace)].length
    : [...withoutSpace].length

  return count > 0 && count <= JUMBO_EMOJI_LIMIT ? count : null
}
