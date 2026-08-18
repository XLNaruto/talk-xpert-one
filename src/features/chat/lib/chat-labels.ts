import type { Id } from '@/types/api'
import type { Chat, ChatMessage, MessageMedia, MessageQuote } from '../types'
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
