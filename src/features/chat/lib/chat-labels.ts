import type { Id } from '@/types/api'
import type { Chat, ChatMessage, Contact, MessageMedia, MessageQuote } from '../types'
import { initialsOf, resolveTalkUser } from './talk-directory'

/**
 * How a chat and a message are written in the UI. Pure — no React, no store
 * reads, so a formatter change can't move a re-render.
 */

/** What the sidebar row and the thread header both draw. */
export interface ChatLabel {
  title: string
  initials: string
  /** A storage KEY — the group's picture, or the other person's avatar. */
  avatarKey: string | null
}

/**
 * A chat's name and picture.
 *
 * A direct chat has `name: null` and `avatar_url: null` — it is named after the
 * other person — so it is drawn from `counterpartName` / `counterpartPhoto`. A
 * group carries its own title and picture, but an unnamed group is still
 * possible, so it falls back rather than printing nothing.
 */
export function chatLabel(chat: Chat): ChatLabel {
  if (chat.type === 'group') {
    const title = chat.name?.trim() || 'Unnamed group'
    return { title, initials: initialsOf(title), avatarKey: chat.avatarUrl }
  }
  const counterpart =
    chat.counterpartTalkUserId !== null
      ? resolveTalkUser(
          chat.counterpartTalkUserId,
          chat.counterpartName,
          chat.counterpartPhoto,
        )
      : null
  const title = counterpart?.name ?? 'Direct message'
  return {
    title,
    initials: counterpart?.initials ?? initialsOf(title),
    avatarKey: counterpart?.avatarKey ?? null,
  }
}

/**
 * The one-line preview under a chat's name.
 *
 * `lastMessagePreview` is null when the last message was a file or was deleted
 * for everyone, so those two cases get their own words rather than an empty row.
 * A group also says who spoke, since the name alone doesn't.
 */
export function previewLine(chat: Chat, selfTalkUserId: Id | null): string {
  if (!chat.lastMessageAt) return 'No messages yet'

  const body = chat.lastMessagePreview?.trim()
  const text = body || 'Attachment'

  const sender = chat.lastMessageSenderTalkUserId
  if (sender === null) return text
  if (sender === selfTalkUserId) return `You: ${text}`
  if (chat.type === 'direct') return text
  return `${resolveTalkUser(sender, chat.lastMessageSenderName).name}: ${text}`
}

/** A short label for an attachment, used where a caption is missing. */
export function mediaLabel(media: MessageMedia): string {
  if (media.fileName?.trim()) return media.fileName.trim()
  switch (media.kind) {
    case 'image':
      return 'Photo'
    case 'video':
      return 'Video'
    case 'audio':
      return 'Audio'
    default:
      return 'Document'
  }
}

/** Human-readable file size, for a document row. */
export function formatBytes(bytes: number | null): string {
  if (bytes == null || bytes <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** power
  return `${value >= 10 || power === 0 ? Math.round(value) : value.toFixed(1)} ${units[power]}`
}

/** `mm:ss`, for an audio or video attachment. */
export function formatDuration(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return ''
  const minutes = Math.floor(seconds / 60)
  const rest = Math.floor(seconds % 60)
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

/**
 * The one line a reply quote shows.
 *
 * Takes the quote itself rather than the message holding it, so the composer's
 * reply bar and the bubble's inline quote go through the same function.
 */
export function quoteText(quote: MessageQuote | null | undefined): string {
  if (!quote) return 'Message'
  if (quote.isDeleted) return 'Deleted message'
  return quote.body?.trim() || quotableType(quote.type)
}

/** The quote on a message, for a bubble that already holds the message. */
export function quoteLine(message: ChatMessage): string {
  return quoteText(message.replyTo)
}

function quotableType(type: string | undefined): string {
  switch (type) {
    case 'image':
      return 'Photo'
    case 'video':
      return 'Video'
    case 'audio':
      return 'Audio'
    case 'document':
      return 'Document'
    default:
      return 'Message'
  }
}

/**
 * The line under a contact's name — in the people picker and in the sidebar's
 * search results. The designation and where they work says the most, and the
 * login is the fallback that always tells two same-named people apart.
 */
export function contactSubtitle(contact: Contact): string | null {
  const placement = [contact.designationName, contact.departmentName ?? contact.companyName]
    .filter(Boolean)
    .join(' · ')
  return placement || contact.email || null
}

/**
 * Why the composer is closed, if it is.
 *
 * Resolved BEFORE a file picker or a drop target is offered, because the presign
 * is refused for exactly the same reasons a send is — better to explain than to
 * let the user pick a 20 MB video and then fail. `useMessageInput` prints it and
 * `chat-area.tsx` reads it to know whether a drop can land at all.
 */
export function composerBlockedReason(
  chat: Chat | null,
  blockedTalkUserIds: Id[],
): string | null {
  if (!chat) return null
  if (chat.self.hasLeft) {
    return chat.type === 'group'
      ? 'You left this group. Ask a member to add you back to post again.'
      : 'This conversation is no longer available.'
  }
  if (chat.self.isBlocked) {
    return 'The group owner has muted you here. You can still read the conversation.'
  }
  if (
    chat.type === 'direct' &&
    chat.counterpartTalkUserId !== null &&
    blockedTalkUserIds.includes(chat.counterpartTalkUserId)
  ) {
    return 'You blocked this person. Unblock them to send a message.'
  }
  return null
}

/** The wording of a "do you mean it?" panel — whatever is asking it. */
export interface ConfirmCopy {
  title: string
  message: string
  confirmLabel: string
  tone: 'default' | 'destructive'
}

/**
 * The question asked before MY private, account-wide block.
 *
 * One function for all three places that ask it — the header's button, the
 * composer's "unblock" and the blocked-contacts list — because the promise it
 * makes is load-bearing: the block is never disclosed to the person it is
 * against, and saying so is what stops a user reaching for it as a warning shot.
 * It also has to say where the undo lives, since a block outlives the
 * conversation it was made from.
 */
export function personBlockCopy(name: string, blocked: boolean): ConfirmCopy {
  if (blocked) {
    return {
      title: `Block ${name}?`,
      // "You stop seeing" rather than "they cannot send": their messages still
      // send and are stored — they simply never reach me — and the hiding is
      // permanent for that stretch, which is the part worth knowing up front.
      message: `You stop seeing anything ${name} sends, and they are not told. Messages sent while they are blocked stay hidden even after you unblock. Undo any time from Settings › Blocked contacts.`,
      confirmLabel: 'Block',
      tone: 'destructive',
    }
  }
  return {
    title: `Unblock ${name}?`,
    // A block is an interval, and closing it hands nothing back: whatever they
    // wrote while it stood stays hidden for good, with no gap marker and nothing
    // to load. Saying so here is the only place a user can learn it before
    // deciding, and it is what stops them unblocking to "see what they missed".
    message: `${name} can message you again. Anything they sent while blocked stays hidden — unblocking does not bring it back.`,
    confirmLabel: 'Unblock',
    tone: 'default',
  }
}

/**
 * The question asked before the GROUP OWNER'S block, which is a different thing
 * entirely: the member stays, keeps reading, and only loses posting — and unlike
 * the private block, they find out the moment they try to post.
 */
export function memberBlockCopy(name: string, groupName: string, blocked: boolean): ConfirmCopy {
  if (blocked) {
    return {
      title: `Stop ${name} posting?`,
      message: `${name} stays in ${groupName} and can still read it, but cannot post until you allow it again.`,
      confirmLabel: 'Stop posting',
      tone: 'destructive',
    }
  }
  return {
    title: `Let ${name} post again?`,
    message: `${name} can post in ${groupName} from now on.`,
    confirmLabel: 'Allow',
    tone: 'default',
  }
}
