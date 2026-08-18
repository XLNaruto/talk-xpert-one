import type { Id } from '@/types/api'
import type { ChatMessage } from '../types'
import { resolveTalkUser } from './talk-directory'

/**
 * System messages arrive as a CODE in `system_event`, not as a sentence — the
 * server does that so the client can render it in the reader's language. This is
 * the one place those codes become English.
 *
 * The actor is the message's sender, so a rename posted by the owner says who did
 * it. `body` carries the detail the code can't — the new group name on a rename.
 */
export function systemMessageText(message: ChatMessage, selfTalkUserId: Id | null): string {
  const actor = actorName(message.senderTalkUserId, message.senderName, selfTalkUserId)
  const detail = message.body?.trim()

  switch (message.systemEvent) {
    case 'group_created':
      return `${actor} created this group`
    case 'group_renamed':
      // The name IS how the group is identified, so it is quoted rather than
      // summarised — "renamed the group" alone would leave the reader guessing.
      return detail ? `${actor} renamed the group to “${detail}”` : `${actor} renamed the group`
    case 'member_added':
      return detail ? `${actor} added ${detail}` : `${actor} added someone`
    case 'member_removed':
      return detail ? `${actor} removed ${detail}` : `${actor} removed someone`
    case 'member_left':
      return `${actor} left the group`
    default:
      // An event this client has never heard of still deserves a line: the row
      // exists in the thread and a blank bubble reads as a bug.
      return detail || 'This conversation was updated'
  }
}

function actorName(
  senderTalkUserId: Id | null,
  senderName: string | null,
  selfTalkUserId: Id | null,
): string {
  if (senderTalkUserId === null) return 'Someone'
  if (senderTalkUserId === selfTalkUserId) return 'You'
  return resolveTalkUser(senderTalkUserId, senderName).name
}
