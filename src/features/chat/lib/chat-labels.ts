import type { Id } from '@/types/api'
import type {
  Chat,
  ChatMessage,
  Contact,
  MessageMedia,
  MessageQuote,
  MessageType,
} from '../types'
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
 * What a deleted-for-everyone row says, in the thread and in the sidebar alike.
 * A tombstone is not an empty message: a blank preview would be read as a file.
 */
export const DELETED_MESSAGE_TEXT = 'This message was deleted'

/**
 * The one-line preview under a chat's name.
 *
 * `lastMessagePreview` is null when the last message was a file or was deleted
 * for everyone, so those two cases get their own words rather than an empty row.
 * A group also says who spoke, since the name alone doesn't.
 */
export function previewLine(chat: Chat, selfTalkUserId: Id | null): string {
  if (!chat.lastMessageAt) return 'No messages yet'

  // A tombstone and a file BOTH arrive with no preview, so the flag is what
  // separates them — without it a deleted message announced an attachment.
  const body = chat.lastMessagePreview?.trim()
  // A file's preview is its KIND, because it has no text of its own — and with a
  // caption it is both, the way the thread shows the picture above the words.
  // "Attachment" is only the fallback for a kind the client has not heard of.
  const attachment = attachmentLabel(chat.lastMessageType)
  const base = chat.lastMessageDeletedForEveryone
    ? DELETED_MESSAGE_TEXT
    : attachment
      ? body
        ? `${attachment} · ${body}`
        : attachment
      : body || 'Attachment'
  // The bubble says "edited" beside the time, and the row quoting that bubble
  // says the same — otherwise a preview that changed on its own looks like a
  // message that was never sent. Never on a tombstone: it was not edited, it
  // was withdrawn.
  const text =
    chat.lastMessageEdited && !chat.lastMessageDeletedForEveryone
      ? `${base} · edited`
      : base

  const sender = chat.lastMessageSenderTalkUserId
  if (sender === null) return text
  if (sender === selfTalkUserId) return `You: ${text}`
  if (chat.type === 'direct') return text
  return `${resolveTalkUser(sender, chat.lastMessageSenderName).name}: ${text}`
}

/**
 * What to call the previewed message when it is a FILE. Null for text and for a
 * system line, which speak for themselves.
 */
function attachmentLabel(type: MessageType): string | null {
  switch (type) {
    case 'image':
      return 'Photo'
    case 'video':
      return 'Video'
    case 'audio':
      // Not "Voice message": an attachment can be any audio file, and calling a
      // shared track a voice note is a small lie the row cannot take back.
      return 'Audio'
    case 'document':
      return 'Document'
    default:
      return null
  }
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

/** The same words the sidebar uses, so a quote and a row never disagree. */
function quotableType(type: string | undefined): string {
  return attachmentLabel(type as MessageType) ?? 'Message'
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
    // An admin can mute now too, so the sentence no longer names the creator.
    return 'An admin has muted you here. You can still read the conversation.'
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
 * The question asked before the GROUP's block, which is a different thing
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

/**
 * The question asked before appointing or standing down an admin.
 *
 * An admin holds the SAME powers over the membership as the creator, so the
 * sentence says what they can do rather than naming the role and leaving the
 * reader to guess. It also says what they cannot: the creator's row stays
 * untouchable, which is what makes this a delegation and not a handover.
 */
export function memberRoleCopy(name: string, groupName: string, promote: boolean): ConfirmCopy {
  if (promote) {
    return {
      title: `Make ${name} an admin?`,
      message: `${name} will be able to add, remove and mute members of ${groupName}, and appoint other admins. They cannot rename or delete the group, and they cannot act on you.`,
      confirmLabel: 'Make admin',
      tone: 'default',
    }
  }
  return {
    title: `Remove ${name} as an admin?`,
    message: `${name} stays in ${groupName} as an ordinary member and loses the ability to change who is in it.`,
    confirmLabel: 'Remove as admin',
    tone: 'destructive',
  }
}

/**
 * What LEAVING a group takes with it — and, for its creator, where the group
 * goes next.
 *
 * The creator may now leave, and the group is handed on rather than left
 * ungoverned: the longest-standing admin, else the longest-standing member. That
 * is neither obvious nor reversible, so the heir is NAMED where the member list
 * can resolve them, and hedged where it cannot.
 */
export function leaveGroupCopy(
  groupName: string,
  isOwner: boolean,
  successorName: string | null,
): ConfirmCopy {
  const base = `You stop receiving messages in ${groupName}. The history stays readable, and an admin can add you back.`
  if (!isOwner) {
    return { title: 'Leave this group?', message: base, confirmLabel: 'Leave', tone: 'destructive' }
  }
  return {
    title: 'Leave this group?',
    message: successorName
      ? `You will no longer be an admin of ${groupName} — ${successorName} takes over. ${base}`
      : `You are the last one out, so ${groupName} is left with no admin: nobody can rename or delete it after this. The history stays readable.`,
    confirmLabel: 'Leave',
    tone: 'destructive',
  }
}

/**
 * Can this row be taken off MY list — `POST /talk/chats/delete`?
 *
 * A direct chat always; a group only once I have LEFT it. Leaving keeps the row,
 * frozen at the moment I left, and hiding it is the second step that gets rid of
 * it for good (nothing sent after I left is mine to be told about, so it cannot
 * come back). A group I am STILL IN is refused by the server with a 400 naming
 * the ids, so the control is not drawn for one.
 */
export function canHideChat(chat: Chat): boolean {
  return chat.type === 'direct' || chat.self.hasLeft
}

/**
 * What HIDING a row takes with it, which is different for the two kinds.
 *
 * A direct chat comes back the moment the other person writes again — nothing
 * shared is deleted, only my view of it. A group I have LEFT does not: messages
 * sent after I left are not mine to be told about, so there is nothing that
 * could bring the row back, and the copy has to say so before the choice is made.
 */
export function removeChatCopy(name: string, isLeftGroup: boolean): ConfirmCopy {
  return {
    title: isLeftGroup ? 'Remove this group from your list?' : 'Remove this conversation?',
    message: isLeftGroup
      ? `${name} leaves your list and its history goes with it. You have already left the group, so nothing will bring the row back — an admin adding you again starts a fresh one.`
      : `${name} leaves your list and its messages are hidden from you. The conversation comes back if they message you again.`,
    confirmLabel: 'Remove',
    tone: 'destructive',
  }
}


/**
 * May this bubble's files be taken off one at a time?
 *
 * The SENDER alone, and the removal is always for everyone — a group owner may
 * not strip somebody else's attachments, the same limit that stops them
 * withdrawing another member's words. A tombstone has no files left to take, and
 * an optimistic row has no server ids to name, so neither is offered the action:
 * the whole point of `media_ids` is that they are `media[].id` values the server
 * issued.
 */
export function canDeleteMessageMedia(message: ChatMessage, isMine: boolean): boolean {
  return (
    isMine &&
    message.id > 0 &&
    !message.isDeletedForEveryone &&
    message.media.length > 0 &&
    message.media.every((item) => item.id > 0)
  )
}

/**
 * Whether removing exactly these files withdraws the WHOLE message.
 *
 * A message with no files and no text is not renderable, so the server withdraws
 * it — and the confirm has to say so rather than asking the generic question,
 * because the caption, the replies pointing at it and the reader's place in the
 * thread all go with it. Knowable before the call: it is the last file and there
 * is no caption.
 */
export function mediaDeleteWithdrawsMessage(message: ChatMessage, mediaIds: Id[]): boolean {
  const named = new Set(mediaIds.map(String))
  const remaining = message.media.filter((item) => !named.has(String(item.id)))
  return remaining.length === 0 && !message.body?.trim()
}

/**
 * The question asked before files come off a message.
 *
 * Two shapes, and the difference is the whole reason this is not one string: the
 * captionless case destroys the bubble, so the copy names that consequence
 * instead of promising only the photo goes.
 */
export function mediaDeleteCopy(message: ChatMessage, mediaIds: Id[]): ConfirmCopy {
  const count = mediaIds.length
  const withdraws = mediaDeleteWithdrawsMessage(message, mediaIds)
  const noun =
    count === 1
      ? (message.media.find((item) => String(item.id) === String(mediaIds[0]))?.kind ===
        'image'
          ? 'photo'
          : 'file')
      : `${count} files`

  return {
    title: count === 1 ? `Delete this ${noun}?` : `Delete ${noun}?`,
    message: withdraws
      ? 'This is the last file and there is no caption, so the whole message goes with it. Everyone in the chat sees it withdrawn.'
      : count === 1
        ? 'It comes off the message for everyone in the chat. The rest of the message stays.'
        : 'They come off the message for everyone in the chat. The rest of the message stays.',
    confirmLabel: withdraws ? 'Delete message' : count === 1 ? 'Delete' : `Delete ${count}`,
    tone: 'destructive',
  }
}


/**
 * The question asked before hiding a whole message from MY view alone.
 *
 * Asked from the full-screen viewer, which is why it counts the files: the
 * reader is looking at ONE photo, and "delete for me" is not a per-file gesture
 * — there is no per-reader variant of that and none is coming, because a bubble
 * with a gap in it for one person is not something any client draws. So the copy
 * names everything that goes, or the reader loses an album expecting to lose a
 * photo.
 *
 * It also promises the other half: nobody is told, and no event fires. That is
 * the whole difference from the sender's delete, and it is the part worth
 * stating before the choice is made.
 */
export function messageHideCopy(message: ChatMessage): ConfirmCopy {
  const files = message.media.length
  const caption = Boolean(message.body?.trim())
  const scope =
    files > 1
      ? `all ${files} files${caption ? ' and its caption' : ''}`
      : caption
        ? 'this file and its caption'
        : 'this file'

  return {
    title: 'Delete this message for you?',
    message: `The whole message leaves your view — ${scope}. Nobody else's view changes and the sender is not told.`,
    confirmLabel: 'Delete for me',
    tone: 'destructive',
  }
}


/**
 * Why a jump to a message did not land, said in the reader's terms.
 *
 * "Too far back" was told for BOTH failures, and it is wrong for the common one:
 * a message deleted for me, written before I joined the group, or received while
 * I had the sender blocked is not up the thread somewhere — it is not in my copy
 * of the conversation at all. Sending that reader scrolling is worse than
 * telling them nothing.
 *
 * The reply quote is what makes this visible: it outlives the message it points
 * at, so the one row most likely to be tapped is the one whose target may be
 * gone. Nothing is said for `found` or for a walk already in flight.
 */
export function seekFailureText(outcome: 'capped' | 'gone'): string {
  return outcome === 'gone'
    ? 'That message no longer exists in this conversation.'
    : 'That message is too far back to open from here.'
}
