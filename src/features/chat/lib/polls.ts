import { formatDistanceStrict } from 'date-fns'
import type { Id } from '@/types/api'
import type { ChatMessage, ChatSelf, Poll, PollOption } from '../types'
import { canManageMembers } from './member-roles'
import { resolveTalkUser } from './talk-directory'

/**
 * How a poll reads and who may act on it. Pure — no React, no store reads.
 */

/**
 * Whether the poll takes votes, judged against the CLOCK as well as the flag.
 *
 * The server closes a timed poll at `ends_at` and tells the room within about
 * thirty seconds; the bubble does not wait for that. From `ends_at` on a vote is
 * a 409 anyway, so offering one would only produce the error.
 */
export function isPollClosed(poll: Poll, now: number): boolean {
  if (poll.isClosed) return true
  return poll.endsAt !== null && new Date(poll.endsAt).getTime() <= now
}

/**
 * The line under the options.
 *
 * Three different endings, and they are not interchangeable: closed by a person
 * names them, closed by the timer says it ended (`closed_by_*` is null then), and
 * an open timed poll counts down.
 */
export function pollStatusLine(poll: Poll, now: number, selfTalkUserId: Id | null): string {
  const voters = `${poll.totalVoters} ${poll.totalVoters === 1 ? 'vote' : 'votes'}`
  if (isPollClosed(poll, now)) {
    if (poll.closedByTalkUserId === null) return `${voters} · Poll ended`
    const who =
      poll.closedByTalkUserId === selfTalkUserId
        ? 'you'
        : resolveTalkUser(poll.closedByTalkUserId, poll.closedByName).name
    return `${voters} · Closed by ${who}`
  }
  if (poll.endsAt) {
    return `${voters} · Ends in ${formatDistanceStrict(new Date(poll.endsAt), now)}`
  }
  return voters
}

/** `vote_count / total_voters`, as a whole percentage. Zero voters is 0%. */
export function optionPercent(option: PollOption, poll: Poll): number {
  if (poll.totalVoters <= 0) return 0
  return Math.round((option.voteCount / poll.totalVoters) * 100)
}

/**
 * What a tap on an option SENDS. A vote replaces my whole choice, so a single
 * choice poll sends just the tapped option — or `[]`, withdrawing, when it is
 * the one I already picked. A multiple-choice poll toggles it in my set.
 */
export function nextPollChoice(poll: Poll, optionId: Id): Id[] {
  const mine = poll.myOptionIds
  const picked = mine.includes(optionId)
  if (!poll.allowMultiple) return picked ? [] : [optionId]
  return picked ? mine.filter((id) => id !== optionId) : [...mine, optionId]
}

/**
 * Who may close it: the poll's sender, and in a group the owner and admins too
 * (`canManage` — see `canManagePolls` below). Nobody who has left or been muted.
 * Closing is one-way, so nobody else is shown the control.
 */
export function canClosePoll(
  message: ChatMessage,
  { isMine, canManage, canInteract }: { isMine: boolean; canManage: boolean; canInteract: boolean },
): boolean {
  if (!message.poll || message.poll.isClosed || !canInteract) return false
  return isMine || canManage
}

/** A group owner or admin, who may close anybody's poll there. */
export function canManagePolls(
  self: Pick<ChatSelf, 'memberRole' | 'hasLeft'>,
  isGroup: boolean,
): boolean {
  return isGroup && canManageMembers(self)
}

/** A poll's timer, in words — "1 h 30 m" — for the create form's summary. */
export function pollDurationLabel(minutes: number | null): string {
  if (minutes === null) return 'No time limit'
  const days = Math.floor(minutes / (24 * 60))
  const hours = Math.floor((minutes % (24 * 60)) / 60)
  const rest = minutes % 60
  return [days && `${days} d`, hours && `${hours} h`, rest && `${rest} m`]
    .filter(Boolean)
    .join(' ')
}

