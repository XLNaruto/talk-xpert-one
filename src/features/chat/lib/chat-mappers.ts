import type { Id } from '@/types/api'
import type {
  BlockedPerson,
  Chat,
  ChatMember,
  ChatMessage,
  ChatSelf,
  ChatType,
  MediaKind,
  MemberRole,
  MessageMedia,
  MessageQuote,
  MessageReceipt,
  MessageSearchHit,
  MessageType,
  PinnedMessage,
  Presence,
  SystemEvent,
} from '../types'

/* ---------------------------------------------------------------- */
/* Raw server payloads — snake_case, exactly as the API sends them   */
/* ---------------------------------------------------------------- */

export interface MessageMediaDto {
  id: number
  kind: string
  file_url: string
  file_name?: string | null
  mime_type?: string | null
  size_bytes?: number | null
  width?: number | null
  height?: number | null
  duration_seconds?: number | null
  thumbnail_url?: string | null
  position?: number
}

export interface MessageQuoteDto {
  id: number
  sender_talk_user_id?: number | null
  sender_name?: string | null
  sender_photo?: string | null
  type: string
  body?: string | null
  is_deleted?: boolean
}

export interface MessageDto {
  id: number
  chat_id: number
  sender_talk_user_id?: number | null
  sender_name?: string | null
  sender_photo?: string | null
  type: string
  body?: string | null
  reply_to_message_id?: number | null
  reply_to?: MessageQuoteDto | null
  forwarded_from_message_id?: number | null
  is_forwarded?: boolean
  is_edited?: boolean
  edited_at?: string | null
  is_deleted_for_everyone?: boolean
  system_event?: string | null
  media?: MessageMediaDto[] | null
  is_pinned?: boolean
  is_read_by_all?: boolean
  read_count?: number
  created_at: string
}

export interface ChatSelfDto {
  member_role?: string
  is_pinned?: boolean
  last_read_message_id?: number | null
  has_left?: boolean
  is_blocked?: boolean
}

export interface ChatDto {
  id: number
  type: string
  name?: string | null
  description?: string | null
  avatar_url?: string | null
  company_id?: number | null
  created_by_talk_user_id: number
  created_by_name?: string | null
  created_by_photo?: string | null
  counterpart_talk_user_id?: number | null
  counterpart_name?: string | null
  counterpart_photo?: string | null
  member_count?: number
  unread_count?: number
  last_message_at?: string | null
  last_message_preview?: string | null
  last_message_sender_talk_user_id?: number | null
  last_message_sender_name?: string | null
  last_message_sender_photo?: string | null
  self?: ChatSelfDto | null
  created_at: string
}

export interface ChatMemberDto {
  talk_user_id: number
  name?: string | null
  photo?: string | null
  member_role?: string
  joined_at: string
  is_blocked?: boolean
  blocked_by_talk_user_id?: number | null
  blocked_by_name?: string | null
  blocked_by_photo?: string | null
}

export interface PinnedMessageDto {
  message_id: number
  pinned_by_talk_user_id: number
  pinned_by_name?: string | null
  pinned_by_photo?: string | null
  pinned_at: string
  expires_at?: string | null
}

export interface PresenceDto {
  talk_user_id: number
  name?: string | null
  photo?: string | null
  is_online?: boolean
  last_seen_at?: string | null
}

export interface MessageReceiptDto {
  talk_user_id: number
  name?: string | null
  photo?: string | null
  delivered_at?: string | null
  read_at?: string | null
}

export interface MessageSearchHitDto {
  id: number
  chat_id: number
  sender_talk_user_id?: number | null
  sender_name?: string | null
  sender_photo?: string | null
  type: string
  body?: string | null
  created_at: string
}

export interface BlockedPersonDto {
  talk_user_id: number
  name?: string | null
  photo?: string | null
  blocked_at: string
}

/* ---------------------------------------------------------------- */
/* Pure mapping. No React, no hooks, no store reads in this folder.  */
/* ---------------------------------------------------------------- */

const MESSAGE_TYPES: MessageType[] = ['text', 'image', 'video', 'audio', 'document', 'system']
const MEDIA_KINDS: MediaKind[] = ['image', 'video', 'audio', 'document']
const MEMBER_ROLES: MemberRole[] = ['owner', 'admin', 'member']
const SYSTEM_EVENTS: SystemEvent[] = [
  'group_created',
  'group_renamed',
  'member_added',
  'member_removed',
  'member_left',
]

/**
 * Narrow a server string to a known union, falling back rather than throwing.
 * A message type the client has never heard of must still render as a bubble.
 */
function oneOf<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

export function toMessageMedia(dto: MessageMediaDto): MessageMedia {
  return {
    id: dto.id,
    kind: oneOf(dto.kind, MEDIA_KINDS, 'document'),
    fileUrl: dto.file_url,
    fileName: dto.file_name ?? null,
    mimeType: dto.mime_type ?? null,
    sizeBytes: dto.size_bytes ?? null,
    width: dto.width ?? null,
    height: dto.height ?? null,
    durationSeconds: dto.duration_seconds ?? null,
    thumbnailUrl: dto.thumbnail_url ?? null,
    position: dto.position ?? 0,
  }
}

export function toMessageQuote(dto: MessageQuoteDto): MessageQuote {
  return {
    id: dto.id,
    senderTalkUserId: dto.sender_talk_user_id ?? null,
    senderName: dto.sender_name ?? null,
    senderPhoto: dto.sender_photo ?? null,
    type: oneOf(dto.type, MESSAGE_TYPES, 'text'),
    body: dto.body ?? null,
    isDeleted: dto.is_deleted ?? false,
  }
}

export function toChatMessage(dto: MessageDto): ChatMessage {
  return {
    id: dto.id,
    chatId: dto.chat_id,
    senderTalkUserId: dto.sender_talk_user_id ?? null,
    senderName: dto.sender_name ?? null,
    senderPhoto: dto.sender_photo ?? null,
    type: oneOf(dto.type, MESSAGE_TYPES, 'text'),
    body: dto.body ?? null,
    replyToMessageId: dto.reply_to_message_id ?? null,
    replyTo: dto.reply_to ? toMessageQuote(dto.reply_to) : null,
    forwardedFromMessageId: dto.forwarded_from_message_id ?? null,
    isForwarded: dto.is_forwarded ?? false,
    isEdited: dto.is_edited ?? false,
    editedAt: dto.edited_at ?? null,
    isDeletedForEveryone: dto.is_deleted_for_everyone ?? false,
    systemEvent: dto.system_event
      ? oneOf(dto.system_event, SYSTEM_EVENTS, 'group_created')
      : null,
    media: (dto.media ?? []).map(toMessageMedia).sort((a, b) => a.position - b.position),
    isPinned: dto.is_pinned ?? false,
    isReadByAll: dto.is_read_by_all ?? false,
    readCount: dto.read_count ?? 0,
    createdAt: dto.created_at,
  }
}

function toChatSelf(dto: ChatSelfDto | null | undefined): ChatSelf {
  return {
    memberRole: oneOf(dto?.member_role, MEMBER_ROLES, 'member'),
    isPinned: dto?.is_pinned ?? false,
    lastReadMessageId: dto?.last_read_message_id ?? null,
    hasLeft: dto?.has_left ?? false,
    isBlocked: dto?.is_blocked ?? false,
  }
}

export function toChat(dto: ChatDto): Chat {
  return {
    id: dto.id,
    type: oneOf<ChatType>(dto.type, ['direct', 'group'], 'direct'),
    name: dto.name ?? null,
    description: dto.description ?? null,
    avatarUrl: dto.avatar_url ?? null,
    companyId: dto.company_id ?? null,
    createdByTalkUserId: dto.created_by_talk_user_id,
    createdByName: dto.created_by_name ?? null,
    createdByPhoto: dto.created_by_photo ?? null,
    counterpartTalkUserId: dto.counterpart_talk_user_id ?? null,
    counterpartName: dto.counterpart_name ?? null,
    counterpartPhoto: dto.counterpart_photo ?? null,
    memberCount: dto.member_count ?? 0,
    unreadCount: dto.unread_count ?? 0,
    lastMessageAt: dto.last_message_at ?? null,
    lastMessagePreview: dto.last_message_preview ?? null,
    lastMessageSenderTalkUserId: dto.last_message_sender_talk_user_id ?? null,
    lastMessageSenderName: dto.last_message_sender_name ?? null,
    lastMessageSenderPhoto: dto.last_message_sender_photo ?? null,
    self: toChatSelf(dto.self),
    createdAt: dto.created_at,
  }
}

export function toChatMember(dto: ChatMemberDto): ChatMember {
  return {
    talkUserId: dto.talk_user_id,
    name: dto.name ?? null,
    photo: dto.photo ?? null,
    memberRole: oneOf(dto.member_role, MEMBER_ROLES, 'member'),
    joinedAt: dto.joined_at,
    isBlocked: dto.is_blocked ?? false,
    blockedByTalkUserId: dto.blocked_by_talk_user_id ?? null,
    blockedByName: dto.blocked_by_name ?? null,
    blockedByPhoto: dto.blocked_by_photo ?? null,
  }
}

export function toPinnedMessage(dto: PinnedMessageDto): PinnedMessage {
  return {
    messageId: dto.message_id,
    pinnedByTalkUserId: dto.pinned_by_talk_user_id,
    pinnedByName: dto.pinned_by_name ?? null,
    pinnedByPhoto: dto.pinned_by_photo ?? null,
    pinnedAt: dto.pinned_at,
    expiresAt: dto.expires_at ?? null,
  }
}

export function toPresence(dto: PresenceDto): Presence {
  return {
    talkUserId: dto.talk_user_id,
    name: dto.name ?? null,
    photo: dto.photo ?? null,
    isOnline: dto.is_online ?? false,
    lastSeenAt: dto.last_seen_at ?? null,
  }
}

export function toMessageReceipt(dto: MessageReceiptDto): MessageReceipt {
  return {
    talkUserId: dto.talk_user_id,
    name: dto.name ?? null,
    photo: dto.photo ?? null,
    deliveredAt: dto.delivered_at ?? null,
    readAt: dto.read_at ?? null,
  }
}

export function toMessageSearchHit(dto: MessageSearchHitDto): MessageSearchHit {
  return {
    id: dto.id,
    chatId: dto.chat_id,
    senderTalkUserId: dto.sender_talk_user_id ?? null,
    senderName: dto.sender_name ?? null,
    senderPhoto: dto.sender_photo ?? null,
    type: oneOf(dto.type, MESSAGE_TYPES, 'text'),
    body: dto.body ?? null,
    createdAt: dto.created_at,
  }
}

export function toBlockedPerson(dto: BlockedPersonDto): BlockedPerson {
  return {
    talkUserId: dto.talk_user_id,
    name: dto.name ?? null,
    photo: dto.photo ?? null,
    blockedAt: dto.blocked_at,
  }
}

/* ---------------------------------------------------------------- */
/* Client-side construction                                          */
/* ---------------------------------------------------------------- */

/**
 * The optimistic bubble, shown the instant the user hits send.
 *
 * Its `id` is NEGATIVE on purpose. Ids are integers and the cache is keyed by
 * id, so a placeholder needs one that can never collide with a real row; going
 * negative also sorts it last, which is where a just-sent message belongs.
 * `clientMessageId` is what actually reconciles it with the server's row.
 */
export function draftMessage(
  chatId: Id,
  senderTalkUserId: Id,
  {
    body,
    media = [],
    replyToMessageId = null,
    replyTo = null,
    clientMessageId,
    senderName = null,
    senderPhoto = null,
  }: {
    body: string | null
    media?: MessageMedia[]
    replyToMessageId?: Id | null
    replyTo?: MessageQuote | null
    clientMessageId: string
    /** My own name and avatar, so the bubble reads the same before and after
        the server's row replaces it. */
    senderName?: string | null
    senderPhoto?: string | null
  },
): ChatMessage {
  return {
    id: -Date.now(),
    chatId,
    senderTalkUserId,
    senderName,
    senderPhoto,
    type: media[0]?.kind ?? 'text',
    body,
    replyToMessageId,
    replyTo,
    forwardedFromMessageId: null,
    isForwarded: false,
    isEdited: false,
    editedAt: null,
    isDeletedForEveryone: false,
    systemEvent: null,
    media,
    isPinned: false,
    isReadByAll: false,
    readCount: 0,
    createdAt: new Date().toISOString(),
    status: 'sending',
    clientMessageId,
  }
}

/** The MIME type a browser reports, mapped onto Talk's four media kinds. */
export function mediaKindFor(mimeType: string): MediaKind {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  return 'document'
}
