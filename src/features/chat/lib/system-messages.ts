import type { Id } from '@/types/api'
import type { ChatMessage, MessageSystemData, SystemParticipant } from '../types'
import { resolveTalkUser } from './talk-directory'

/**
 * How a system message is written.
 *
 * The server sends BOTH: `body` is a ready-to-render sentence ("Minato created
 * the group and added Draco Employee"), and `system_data` carries the operands
 * it was rendered from — who acted, who it happened to, the old and new name on
 * a rename. A system message has NO sender: the actor is `system_data.by`.
 *
 * We render from the operands when we recognise the event, because only the
 * client knows who is reading: the server cannot write "You added Draco". When
 * the event code is one this client has never heard of, or the operands are
 * missing, the server's sentence is the fallback — a blank line reads as a bug.
 */
export function systemMessageText(message: ChatMessage, selfTalkUserId: Id | null): string {
  const data = message.systemData
  const fallback = message.body?.trim() || 'This conversation was updated'
  if (!data) return fallback

  switch (message.systemEvent) {
    case 'group_created': {
      // The create and the first invites are one event, so they are one
      // sentence — two lines for a single action reads as two actions.
      const actor = actorName(data.by ?? data.subject, selfTalkUserId)
      const people = listNames(data.members, selfTalkUserId)
      return people
        ? `${actor} created the group and added ${people}`
        : `${actor} created the group`
    }
    case 'group_renamed': {
      // The name IS how the group is identified, so it is quoted rather than
      // summarised — "renamed the group" alone would leave the reader guessing.
      const actor = actorName(data.by ?? data.subject, selfTalkUserId)
      const to = data.to?.trim() || message.body?.trim()
      return to ? `${actor} renamed the group to “${to}”` : `${actor} renamed the group`
    }
    case 'member_added': {
      const actor = actorName(data.by, selfTalkUserId)
      // A flat payload names the person it happened to, not the actor.
      const people = listNames(subjects(data), selfTalkUserId)
      return people ? `${actor} added ${people}` : `${actor} added someone`
    }
    case 'member_removed': {
      const actor = actorName(data.by, selfTalkUserId)
      const people = listNames(subjects(data), selfTalkUserId)
      return people ? `${actor} removed ${people}` : `${actor} removed someone`
    }
    case 'member_left': {
      // Leaving is done BY the person it happens to, so the flat `subject` and
      // a one-name `members` are both the actor here — not somebody else's doing.
      const actor = actorName(data.by ?? data.subject ?? data.members[0] ?? null, selfTalkUserId)
      return `${actor} left the group`
    }
    default:
      return fallback
  }
}

/**
 * Who an event happened TO. `members[]` when the server sent a list, and the
 * flat single person when it sent one operand instead.
 */
function subjects(data: MessageSystemData): SystemParticipant[] {
  if (data.members.length > 0) return data.members
  return data.subject ? [data.subject] : []
}

/** Who did it. Sentence-initial, so yourself is "You". */
function actorName(actor: SystemParticipant | null, selfTalkUserId: Id | null): string {
  if (!actor) return 'Someone'
  if (actor.talkUserId === selfTalkUserId) return 'You'
  return resolveTalkUser(actor.talkUserId, actor.name).name
}

/**
 * Who it happened to: "Draco", "Draco and Ana", "Draco, Ana and 2 others".
 *
 * Mid-sentence, so yourself is a lowercase "you", and yourself is moved to the
 * front — "added you and Ana" is the fact the reader cares about first. Past
 * three names it counts, because a group invite can name twenty people and a
 * twenty-name line stops being a sentence.
 */
function listNames(members: SystemParticipant[], selfTalkUserId: Id | null): string {
  if (members.length === 0) return ''

  const ordered = [...members].sort((a, b) => {
    if (a.talkUserId === selfTalkUserId) return -1
    if (b.talkUserId === selfTalkUserId) return 1
    return 0
  })

  const names = ordered.map((member) =>
    member.talkUserId === selfTalkUserId
      ? 'you'
      : resolveTalkUser(member.talkUserId, member.name).name,
  )

  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`

  const rest = names.length - 2
  return `${names[0]}, ${names[1]} and ${rest} others`
}
