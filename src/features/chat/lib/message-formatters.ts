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

/**
 * True when this message opens a new visual run — it gets an author name in a
 * group, and the extra spacing above.
 *
 * A system message always breaks the run: it belongs to nobody, so folding it
 * into the previous speaker's block would attribute it to them.
 */
export function startsNewGroup(
  message: ChatMessage,
  previous: ChatMessage | undefined,
): boolean {
  if (!previous) return true
  if (message.type === 'system' || previous.type === 'system') return true
  if (previous.senderTalkUserId !== message.senderTalkUserId) return true
  const gapMs =
    new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime()
  return gapMs > 5 * 60 * 1000
}

/** True when a day divider belongs above this message. */
export function startsNewDay(
  message: ChatMessage,
  previous: ChatMessage | undefined,
): boolean {
  if (!previous) return true
  return (
    new Date(previous.createdAt).toDateString() !== new Date(message.createdAt).toDateString()
  )
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
export function formatTypingLine(names: string[]): string {
  if (names.length === 0) return ''
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
