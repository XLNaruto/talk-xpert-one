import type { Id } from '@/types/api'
import type {
  BlockedPerson,
  Chat,
  ChatMember,
  ChatMessage,
  ChatSelf,
  ChatType,
  Contact,
  MediaKind,
  MemberRole,
  MessageMedia,
  MessageQuote,
  MessageReceipt,
  MessageSearchHit,
  MessageSystemData,
  MessageType,
  PinnedMessage,
  Presence,
  SystemEvent,
  SystemParticipant,
} from '../types'
import { quoteMedia } from './quote-preview'

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
  /**
   * The quote is a SUMMARY and may carry no attachments at all. Read when it
   * does, so a quote that arrives with its photo needs nothing looked up.
   */
  media?: MessageMediaDto[] | null
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
  system_data?: Record<string, unknown> | null
  media?: MessageMediaDto[] | null
  /** The CHAT-WIDE pin — the same value for every reader. */
  is_pinned?: boolean
  /** MY private bookmark on the same message. The two are independent. */
  is_pinned_for_me?: boolean
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
  /**
   * The last message's SHAPE, for the two cases where the preview alone is not
   * enough to write the row: a system event has no sender but names an actor in
   * `last_message_system_data`, and a tombstone has no preview at all.
   */
  last_message_type?: string | null
  last_message_deleted_for_everyone?: boolean | null
  /** The bubble's `is_read_by_all`, asked of the PREVIEWED message. */
  last_message_is_read_by_all?: boolean | null
  /** The bubble's `is_edited`, asked of the same message. Not sent today. */
  last_message_is_edited?: boolean | null
  last_message_system_event?: string | null
  last_message_system_data?: Record<string, unknown> | null
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
  /** True for the chat-wide pin, false for the pinner's own private one. */
  for_everyone?: boolean
  pinned_by_talk_user_id: number
  pinned_by_name?: string | null
  pinned_by_photo?: string | null
  pinned_at: string
  expires_at?: string | null
  /** The pinned message, inline — the pin screen needs no second round trip. */
  message?: MessageDto | null
}

export interface PresenceDto {
  talk_user_id: number
  name?: string | null
  photo?: string | null
  is_online?: boolean
  last_seen_at?: string | null
}

export interface MessageReceiptDto {
  /** Only on the rows `talk.message.read` carries — see `MessageReceipt`. */
  message_id?: number | null
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

export interface ContactDto {
  talk_user_id: number
  name?: string | null
  photo?: string | null
  email: string
  is_employee?: boolean
  company_id?: number | null
  company_name?: string | null
  department_id?: number | null
  department_name?: string | null
  designation_name?: string | null
  existing_chat_id?: number | null
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
  'member_promoted',
  'member_demoted',
  'owner_transferred',
]

/**
 * Narrow a server string to a known union, falling back rather than throwing.
 * A message type the client has never heard of must still render as a bubble.
 */
function oneOf<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

/**
 * Narrow a `member_role` off the wire. Used by the role write's own response and
 * by `talk.member.role_changed`, both of which answer the role on its own rather
 * than inside a member row.
 */
export function toMemberRole(value: unknown, fallback: MemberRole = 'member'): MemberRole {
  return oneOf(value, MEMBER_ROLES, fallback)
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
    ...quoteMedia((dto.media ?? []).map(toMessageMedia)),
  }
}

/**
 * A system message's operands.
 *
 * The server sends `body` already rendered, so this is not what the line SAYS —
 * it is what the line is ABOUT: who acted, who it happened to, and the old and
 * new names on a rename. The shape is PER-EVENT and not uniform: a
 * `member_added` carries the actor in `by_*` and the people in `members[]`,
 * while a `member_left` carries one person FLAT (`talk_user_id`/`name`/`photo`)
 * because the actor and the subject are the same person. So the flat person is
 * read into `subject` and the renderer decides which role it plays for the
 * event it is writing. Whatever this mapper does not recognise survives in
 * `extra` rather than being dropped.
 */
export function toMessageSystemData(
  raw: Record<string, unknown> | null | undefined,
): MessageSystemData | null {
  if (!raw || typeof raw !== 'object') return null

  const {
    by_talk_user_id,
    actor_talk_user_id,
    by_name,
    by_photo,
    talk_user_id,
    name,
    photo,
    members,
    member_talk_user_ids,
    from,
    to,
    old_name,
    new_name,
    ...extra
  } = raw as Record<string, unknown>

  const byId = numberOrNull(by_talk_user_id) ?? numberOrNull(actor_talk_user_id)

  return {
    by:
      byId === null
        ? null
        : { talkUserId: byId, name: stringOrNull(by_name), photo: stringOrNull(by_photo) },
    subject: toSystemParticipant(talk_user_id, name, photo),
    members: toSystemParticipants(members, member_talk_user_ids),
    from: stringOrNull(from) ?? stringOrNull(old_name),
    to: stringOrNull(to) ?? stringOrNull(new_name),
    extra,
  }
}

/** The one person a flat, single-subject event is about — `member_left`. */
function toSystemParticipant(
  talkUserId: unknown,
  name: unknown,
  photo: unknown,
): SystemParticipant | null {
  const id = numberOrNull(talkUserId)
  if (id === null) return null
  return { talkUserId: id, name: stringOrNull(name), photo: stringOrNull(photo) }
}

/**
 * `members` is the rich list; `member_talk_user_ids` is the same people as bare
 * ids and is the fallback, so a payload that only carried ids still names
 * everybody through the directory rather than rendering nothing.
 */
function toSystemParticipants(members: unknown, ids: unknown): SystemParticipant[] {
  if (Array.isArray(members)) {
    return members
      .map((entry) => {
        const row = (entry ?? {}) as Record<string, unknown>
        return toSystemParticipant(row.talk_user_id, row.name, row.photo)
      })
      .filter((entry): entry is SystemParticipant => entry !== null)
  }

  if (Array.isArray(ids)) {
    return ids
      .map((id) => numberOrNull(id))
      .filter((id): id is number => id !== null)
      .map((talkUserId) => ({ talkUserId, name: null, photo: null }))
  }

  return []
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
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
    // An event code this client has never heard of stays NULL rather than being
    // forced onto a known one: the renderer then prints the server's own
    // sentence, which is right, instead of a confidently wrong one.
    systemEvent: SYSTEM_EVENTS.includes(dto.system_event as SystemEvent)
      ? (dto.system_event as SystemEvent)
      : null,
    systemData: toMessageSystemData(dto.system_data),
    media: (dto.media ?? []).map(toMessageMedia).sort((a, b) => a.position - b.position),
    isPinned: dto.is_pinned ?? false,
    isPinnedForMe: dto.is_pinned_for_me ?? false,
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

/** `by`, then the flat subject, then the first member — the sentences' order. */
function systemDataActor(
  data: MessageSystemData | null,
): { talkUserId: number; name: string | null; photo: string | null } | null {
  return data ? (data.by ?? data.subject ?? data.members[0] ?? null) : null
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
    lastMessageType: oneOf(dto.last_message_type, MESSAGE_TYPES, 'text'),
    lastMessageDeletedForEveryone: dto.last_message_deleted_for_everyone ?? false,
    lastMessageReadByAll: dto.last_message_is_read_by_all ?? false,
    lastMessageEdited: dto.last_message_is_edited ?? false,
    // A system last message has no sender, so WHO acted comes out of the same
    // operands the thread renders from — `by`, or the flat subject on an event
    // where the actor and the subject are one person.
    lastMessageActor: systemDataActor(toMessageSystemData(dto.last_message_system_data)),
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
    // The server's own default: a pin with no flag on it is the chat-wide one.
    forEveryone: dto.for_everyone ?? true,
    pinnedByTalkUserId: dto.pinned_by_talk_user_id,
    pinnedByName: dto.pinned_by_name ?? null,
    pinnedByPhoto: dto.pinned_by_photo ?? null,
    pinnedAt: dto.pinned_at,
    expiresAt: dto.expires_at ?? null,
    message: dto.message ? toChatMessage(dto.message) : null,
  }
}

/**
 * What tells two pins on the same message apart: WHO they are for.
 *
 * Under `scope=all` a message pinned both ways comes back as two rows — two
 * pinners, two expiries, and unpinning one leaves the other — so the message id
 * alone is not a key, and de-duping on it would silently drop one of them.
 */
export function pinKey(pin: PinnedMessage): string {
  return `${pin.messageId}:${pin.forEveryone ? 'all' : 'me'}`
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
    messageId: dto.message_id ?? null,
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

export function toContact(dto: ContactDto): Contact {
  return {
    talkUserId: dto.talk_user_id,
    name: dto.name ?? null,
    photo: dto.photo ?? null,
    email: dto.email,
    isEmployee: dto.is_employee ?? false,
    companyId: dto.company_id ?? null,
    companyName: dto.company_name ?? null,
    departmentId: dto.department_id ?? null,
    departmentName: dto.department_name ?? null,
    designationName: dto.designation_name ?? null,
    existingChatId: dto.existing_chat_id ?? null,
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
    systemData: null,
    media,
    isPinned: false,
    isPinnedForMe: false,
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
