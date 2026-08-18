import { format, isThisYear, isToday, isYesterday } from 'date-fns'
import type { ChatMessage, Presence } from '../types'

/** Bubble timestamp — time only, since the day divider carries the date. */
export function formatMessageTime(iso: string): string {
  return format(new Date(iso), 'HH:mm')
}

/** Chat-list timestamp — the coarsest label that stays unambiguous. */
export function formatChatTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (isToday(date)) return format(date, 'HH:mm')
  if (isYesterday(date)) return 'Yesterday'
  return isThisYear(date) ? format(date, 'd MMM') : format(date, 'd MMM yyyy')
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
  if (isToday(date)) return `Last seen at ${format(date, 'HH:mm')}`
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
