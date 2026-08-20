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

/**
 * One person named INSIDE a system message's operands. The name and photo are
 * the ones they had AT THE TIME the event happened, so an old line still reads
 * correctly after somebody is renamed or leaves.
 */
export interface SystemParticipant {
  talkUserId: Id
  name: string | null
  /** Storage KEY — through `useMediaUrl()`, like every other photo. */
  photo: string | null
}

/**
 * The operands the server rendered `body` from.
 *
 * A system message carries no `sender_talk_user_id` — it belongs to the
 * conversation, not to a person — so WHO did it lives here, in `by`. `members`
 * is who it was done to (added, removed, or the group's first members), and
 * `from`/`to` carry a rename. Everything else the server sends survives in
 * `extra`, so a new operand needs no mapper change to reach a renderer.
 */
export interface MessageSystemData {
  by: SystemParticipant | null
  /**
   * The one person a FLAT event is about, sent as a bare
   * `talk_user_id`/`name`/`photo` beside no `by_*` and no `members[]` —
   * `member_left`, where the actor and the subject are the same person. Which
   * role it plays is the renderer's call, per event.
   */
  subject: SystemParticipant | null
  members: SystemParticipant[]
  /** The group's previous name, on `group_renamed`. */
  from: string | null
  /** Its new name, on `group_renamed`. */
  to: string | null
  extra: Record<string, unknown>
}

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
  /**
   * The text, or the caption on a media message. Null on a bare attachment.
   * On a SYSTEM message this is the server's ready-to-render sentence — the
   * fallback for an event code this client has never heard of.
   */
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
  /** The operands behind `systemEvent`. Null on every non-system message. */
  systemData: MessageSystemData | null
  media: MessageMedia[]
  /**
   * Pinned for EVERYONE — the chat-wide announcement bar, the same value for
   * every reader. Independent of `isPinnedForMe` in both directions.
   */
  isPinned: boolean
  /**
   * Pinned for ME — my own private bookmark. Nobody else's view changes and
   * nobody else is told, so this differs per reader on the same message.
   */
  isPinnedForMe: boolean
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
  /**
   * Why the send failed, on a `failed` row. Printed under the bubble, so it
   * survives the toast the user has already dismissed.
   */
  failureReason?: string
  /**
   * Whether replaying it could help. False when the SERVER refused — a 403 from
   * a person who has blocked me is refused identically every time, so the bubble
   * states the reason instead of offering a retry that cannot work.
   */
  canRetry?: boolean
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
  /**
   * Messages past my read frontier. My own never count, and neither do messages
   * hidden by a block window — an unreachable message cannot leave a badge that
   * nothing clears. The sum of these across the list IS `GET /talk/unread`.
   */
  unreadCount: number
  /**
   * When the last message **I can still see** was sent — per VIEWER, not the
   * conversation's shared timestamp. Null on a chat I cleared or deleted with
   * nothing newer since, and on a chat nobody has spoken in.
   */
  lastMessageAt: string | null
  /**
   * Null when the last message was a file, or was deleted for everyone. It, the
   * timestamp and the sender always describe the SAME message — the newest one
   * visible to me.
   */
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

/**
 * Which pins a read is asking for. `everyone` is the chat-wide bar (the server's
 * default), `me` is my own private bookmarks, `all` is both interleaved by when
 * each pin was made — and under `all` a message pinned BOTH ways appears TWICE,
 * as two rows with two pinners and two expiries.
 */
export type PinScope = 'everyone' | 'me' | 'all'

export interface PinnedMessage {
  messageId: Id
  /**
   * True for the chat-wide pin, false for a private one — in which case
   * `pinnedByTalkUserId` is ME. An unpin removes exactly one of the two, chosen
   * by the `forEveryone` it is sent with.
   */
  forEveryone: boolean
  pinnedByTalkUserId: Id
  pinnedByName: string | null
  pinnedByPhoto: string | null
  pinnedAt: string
  expiresAt: string | null
  /**
   * The pinned message ITSELF, in the same shape the thread returns it — so the
   * pin screen renders in ONE call, without hunting for a message that may sit
   * a hundred pages back in the history.
   */
  message: ChatMessage | null
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

/**
 * One row of `GET /talk/contacts` — somebody I may start a chat with.
 *
 * Who appears is MY reach, read live per request: the companies and departments
 * an administrator granted me, minus everyone unopenable — myself, suspended
 * credentials, deleted master records, and either direction of a block. Nobody
 * is here by assumption, so an empty list means no grants rather than an error.
 *
 * `companyId` / `departmentId` are where THEY work, not which grant of mine
 * matched them. Presence is deliberately absent — it moves far faster than this
 * list, so take the ids to `GET /talk/presence`.
 */
export interface Contact {
  /** A `talk_users.id` — what `POST /talk/chats/direct` and `/group` take. */
  talkUserId: Id
  /** Display name. Null when the master record is gone. */
  name: string | null
  /** Avatar storage KEY — read it through `useMediaUrl()`. */
  photo: string | null
  /** Their Talk login. Shown to tell two people of the same name apart. */
  email: string
  /** True for a workforce identity, false for a back-office one. */
  isEmployee: boolean
  companyId: Id | null
  companyName: string | null
  /** From their CURRENT posting. Null for a back-office user, who has none. */
  departmentId: Id | null
  departmentName: string | null
  designationName: string | null
  /** My existing direct chat with them — open it instead of asking the server. */
  existingChatId: Id | null
}

export interface ContactQuery {
  /** Case-insensitive partial match on the name or the Talk login. */
  search?: string
  companyId?: Id
  /** Employees only — a back-office user has no department to be in. */
  departmentId?: Id
  limit?: number
  offset?: number
}

export interface BlockedPerson {
  talkUserId: Id
  name: string | null
  photo: string | null
  /**
   * When the CURRENT block episode began, not when the row was first written —
   * a block is an interval, and re-blocking somebody starts a new one.
   */
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
