/** UI-facing chat types. Raw server shapes stay in `lib/chat-mappers.ts`. */
import type { Id } from '@/types/api'

export type ChatType = 'direct' | 'group'

/** `owner` may rename, add, remove and block; `admin` assists; `member` reads. */
export type MemberRole = 'owner' | 'admin' | 'member'

/** Derived server-side from what a message carries — never a request field. */
export type MessageType = 'text' | 'image' | 'video' | 'audio' | 'document' | 'system'

export type MediaKind = 'image' | 'video' | 'audio' | 'document'

/**
 * A system message's event, as a CODE rather than a sentence — so the client
 * renders it in the reader's language. See `lib/system-messages.ts`.
 */
export type SystemEvent =
  | 'group_created'
  | 'group_renamed'
  | 'member_added'
  | 'member_removed'
  | 'member_left'

/** One attachment on a message. `fileUrl`/`thumbnailUrl` are storage KEYS. */
export interface MessageMedia {
  id: Id
  kind: MediaKind
  /** A storage key, despite the name. Prefix with `media_path` to display it. */
  fileUrl: string
  fileName: string | null
  mimeType: string | null
  sizeBytes: number | null
  width: number | null
  height: number | null
  durationSeconds: number | null
  thumbnailUrl: string | null
  position: number
}

/** The inline quote on a reply — rendered directly, with no second request. */
export interface MessageQuote {
  id: Id
  senderTalkUserId: Id | null
  /** Display name. Null when the master record is gone. */
  senderName: string | null
  /** Avatar storage KEY — read it through `useMediaUrl()`. */
  senderPhoto: string | null
  type: MessageType
  /** Null once the quoted message was deleted for everyone. */
  body: string | null
  isDeleted: boolean
}

/**
 * How an outgoing message is doing. `sending` and `failed` are CLIENT-only —
 * the server has no such column, and a failed message keeps its bubble so the
 * user can retry instead of losing what they typed.
 */
export type MessageStatus = 'sending' | 'sent' | 'read' | 'failed'

export interface ChatMessage {
  id: Id
  chatId: Id
  /** Null on a system message. Compare with your own to decide "this is mine". */
  senderTalkUserId: Id | null
  /** Who sent it. Null on a system message, and when the record is gone. */
  senderName: string | null
  /** Their avatar's storage KEY — read it through `useMediaUrl()`. */
  senderPhoto: string | null
  type: MessageType
  /** The text, or the caption on a media message. Null on a bare attachment. */
  body: string | null
  replyToMessageId: Id | null
  replyTo: MessageQuote | null
  forwardedFromMessageId: Id | null
  /** True on a forward even when the original is gone — hence a flag. */
  isForwarded: boolean
  isEdited: boolean
  editedAt: string | null
  /** Render the tombstone: the row survives so replies still resolve. */
  isDeletedForEveryone: boolean
  systemEvent: SystemEvent | null
  media: MessageMedia[]
  isPinned: boolean
  /** The blue tick. Always false on a message you did not send. */
  isReadByAll: boolean
  /** 0 on a message you did not send, for the same reason. */
  readCount: number
  /** ISO 8601 — a string, not a Date, so it survives IndexedDB. */
  createdAt: string

  /* ---- client-only fields, never sent by the server ---- */
  /** Set while an optimistic send is in flight or has failed. */
  status?: MessageStatus
  /**
   * The idempotency key this bubble was sent with. Reconciles the optimistic
   * row against both the HTTP response and the `talk.message.new` echo.
   */
  clientMessageId?: string
  /** 0–1 while an attachment uploads. */
  uploadProgress?: number
}

/** What I am, in one chat. Drives the composer's enabled state. */
export interface ChatSelf {
  memberRole: MemberRole
  /** Pinned to the top of MY list — nobody else sees this. */
  isPinned: boolean
  lastReadMessageId: Id | null
  hasLeft: boolean
  /** Blocked by the group owner: reads on, posting off. */
  isBlocked: boolean
}

/** One row of `GET /talk/chats` — and, identically, one chat's header. */
export interface Chat {
  id: Id
  type: ChatType
  /** The group title. Null on a direct chat, which is named after the other person. */
  name: string | null
  description: string | null
  /** A storage KEY, not an absolute URL. */
  avatarUrl: string | null
  companyId: Id | null
  createdByTalkUserId: Id
  createdByName: string | null
  createdByPhoto: string | null
  /** The OTHER participant of a direct chat. Null on a group. */
  counterpartTalkUserId: Id | null
  /**
   * A direct chat's TITLE. It has no `name` of its own — it is named after the
   * other person — so the row is drawn with this. Null on a group.
   */
  counterpartName: string | null
  /**
   * A direct chat's AVATAR, for the same reason: `avatarUrl` is the group's
   * picture and is null here. A storage KEY, not a URL.
   */
  counterpartPhoto: string | null
  memberCount: number
  /** Messages past my read frontier. My own never count. */
  unreadCount: number
  lastMessageAt: string | null
  /** Null when the last message was a file, or was deleted for everyone. */
  lastMessagePreview: string | null
  lastMessageSenderTalkUserId: Id | null
  /** Who sent the preview — the "Asha: see you at 4" prefix a group row draws. */
  lastMessageSenderName: string | null
  lastMessageSenderPhoto: string | null
  self: ChatSelf
  createdAt: string
}

export interface ChatMember {
  talkUserId: Id
  name: string | null
  /** Avatar storage KEY — read it through `useMediaUrl()`. */
  photo: string | null
  memberRole: MemberRole
  joinedAt: string
  isBlocked: boolean
  blockedByTalkUserId: Id | null
  blockedByName: string | null
  blockedByPhoto: string | null
}

export interface PinnedMessage {
  messageId: Id
  pinnedByTalkUserId: Id
  pinnedByName: string | null
  pinnedByPhoto: string | null
  pinnedAt: string
  expiresAt: string | null
}

export interface Presence {
  talkUserId: Id
  name: string | null
  photo: string | null
  isOnline: boolean
  lastSeenAt: string | null
}

export interface MessageReceipt {
  talkUserId: Id
  name: string | null
  photo: string | null
  deliveredAt: string | null
  readAt: string | null
}

/** A row of `GET /talk/messages/search` — a lean message, not the full object. */
export interface MessageSearchHit {
  id: Id
  chatId: Id
  senderTalkUserId: Id | null
  senderName: string | null
  senderPhoto: string | null
  type: MessageType
  body: string | null
  createdAt: string
}

export interface BlockedPerson {
  talkUserId: Id
  name: string | null
  photo: string | null
  blockedAt: string
}

/* ---------------------------------------------------------------- */
/* Request shapes                                                    */
/* ---------------------------------------------------------------- */

/** One attachment, already uploaded — this is the KEY, not the bytes. */
export interface OutgoingMedia {
  kind: MediaKind
  /** The `key` from the presign. */
  fileUrl: string
  fileName?: string | null
  mimeType?: string | null
  sizeBytes?: number | null
  width?: number | null
  height?: number | null
  durationSeconds?: number | null
  thumbnailUrl?: string | null
}

export interface SendMessageInput {
  chatId: Id
  body?: string | null
  media?: OutgoingMedia[]
  replyToMessageId?: Id | null
  /**
   * A fresh UUID per send, which makes the request IDEMPOTENT — a retry on a
   * flaky connection answers the SAME message rather than a second bubble.
   */
  clientMessageId: string
}

export interface ChatListQuery {
  search?: string
  type?: ChatType
  pinnedOnly?: boolean
  unreadOnly?: boolean
  limit?: number
  offset?: number
}

export interface CreateGroupInput {
  name: string
  description?: string | null
  /** A storage key from the avatar presign. */
  avatarUrl?: string | null
  companyId?: Id | null
  talkUserIds: Id[]
}

export interface UpdateChatInput {
  name?: string
  description?: string | null
  avatarUrl?: string | null
}
