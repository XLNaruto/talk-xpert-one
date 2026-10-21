import type {
  Broadcast,
  BroadcastList,
  BroadcastRecipient,
  BroadcastSkipReason,
} from '../types'
import { attachmentLabel } from './chat-labels'
import { resolveTalkUser } from './talk-directory'

/**
 * How broadcast lists and their sends are written. Pure — no React.
 */

/**
 * A list's title: its name, or — for an unnamed list — the people on it, which
 * is all the screen has to tell two unnamed lists apart. Without the recipients
 * loaded (a row of the lists screen) the count stands in.
 */
export function broadcastListTitle(
  list: Pick<BroadcastList, 'name' | 'recipientCount'>,
  recipients?: BroadcastRecipient[],
): string {
  if (list.name) return list.name
  if (recipients && recipients.length > 0) {
    const names = recipients
      .slice(0, 3)
      .map((recipient) => resolveTalkUser(recipient.talkUserId, recipient.name).name)
    const rest = recipients.length - names.length
    return rest > 0 ? `${names.join(', ')} and ${rest} more` : names.join(', ')
  }
  return recipientCountLine(list.recipientCount)
}

export function recipientCountLine(count: number): string {
  return `${count} ${count === 1 ? 'recipient' : 'recipients'}`
}

/** The one-line preview of a sent broadcast: its text, else what it carried. */
export function broadcastPreview(broadcast: Broadcast | null): string {
  if (!broadcast) return 'Nothing sent yet'
  const body = broadcast.body?.trim()
  const kind = attachmentLabel(broadcast.type)
  if (kind && body) return `${kind} · ${body}`
  return body || kind || 'Attachment'
}

/**
 * "6/6" — stored in each 1:1 chat, over everyone on the list then. Delivered
 * means STORED: there is no device receipt yet, so no grey double tick.
 */
export function deliveredLine(broadcast: Pick<Broadcast, 'deliveredCount' | 'recipientCount'>): string {
  return `${broadcast.deliveredCount}/${broadcast.recipientCount}`
}

/** Why somebody got no copy, in their terms rather than the server's code. */
export function skipReasonText(reason: BroadcastSkipReason | null): string {
  switch (reason) {
    case 'blocked_by_you':
      return 'You blocked this person'
    case 'unavailable':
      return 'Not available on Talk'
    case 'error':
      return "Couldn't send"
    default:
      return 'Not sent'
  }
}
