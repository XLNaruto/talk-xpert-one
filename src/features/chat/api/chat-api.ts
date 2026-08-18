import { apiClient } from '@/lib/api-client'
import { ENDPOINTS } from '@/lib/endpoints'
import { ATTACHMENT_CONTENT_TYPES, AVATAR_CONTENT_TYPES, uploadFile } from '@/lib/uploads'
import { rememberPeople } from '@/stores/talk-directory-store'
import type { Id, ListPage, MessagePage } from '@/types/api'
import { CHAT_PAGE_SIZE, MESSAGE_PAGE_SIZE } from '../constants'
import {
  toBlockedPerson,
  toChat,
  toChatMember,
  toChatMessage,
  toMessageMedia,
  toMessageReceipt,
  toMessageSearchHit,
  toPinnedMessage,
  toPresence,
  type BlockedPersonDto,
  type ChatDto,
  type ChatMemberDto,
  type MessageDto,
  type MessageMediaDto,
  type MessageReceiptDto,
  type MessageSearchHitDto,
  type PinnedMessageDto,
  type PresenceDto,
} from '../lib/chat-mappers'
import {
  peopleInBlock,
  peopleInChat,
  peopleInMember,
  peopleInMessage,
  peopleInPin,
  peopleInPresence,
  peopleInReceipt,
  peopleInSearchHit,
} from '../lib/talk-directory'
import type {
  BlockedPerson,
  Chat,
  ChatListQuery,
  ChatMember,
  ChatMessage,
  CreateGroupInput,
  MediaKind,
  MessageMedia,
  MessageReceipt,
  MessageSearchHit,
  OutgoingMedia,
  PinnedMessage,
  Presence,
  SendMessageInput,
  UpdateChatInput,
} from '../types'

/**
 * The ONLY place axios is called for chat. Hooks in `api/` wrap these.
 *
 * There is no envelope anywhere: a list answers `{ items, total }` and a single
 * record answers itself. Every response goes through a mapper.
 */

/** Drop undefined so axios doesn't serialise `?search=undefined`. */
function params(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, v]) => v !== undefined))
}

/* ---------------------------------------------------------------- */
/* Chats                                                             */
/* ---------------------------------------------------------------- */

/**
 * The chat list.
 *
 * Already ordered — PINNED first, then newest — so do not re-sort it. `search`
 * must be server-side: it matches a group on its name AND a direct chat on the
 * other participant's name, and the second cannot be done against the response.
 *
 * Reading this also refreshes the socket GRANTS for every row, which is what
 * makes `talk:join` succeed afterwards.
 */
export async function fetchChats(query: ChatListQuery = {}): Promise<ListPage<Chat>> {
  const res = await apiClient.get<{ items: ChatDto[]; total: number }>(ENDPOINTS.chats.list, {
    params: params({
      search: query.search || undefined,
      type: query.type,
      pinned_only: query.pinnedOnly || undefined,
      unread_only: query.unreadOnly || undefined,
      limit: query.limit ?? CHAT_PAGE_SIZE,
      offset: query.offset ?? 0,
    }),
  })
  const items = (res.data.items ?? []).map(toChat)
  // Every read that names people feeds the directory, because typing and
  // presence arrive over the socket as a bare id and have nothing else to go on.
  rememberPeople(items.flatMap(peopleInChat))
  return { items, total: res.data.total ?? 0 }
}

/** One chat's header — the same shape and query as a list row, so they agree. */
export async function fetchChat(chatId: Id): Promise<Chat> {
  const res = await apiClient.get<ChatDto>(ENDPOINTS.chats.detail(chatId))
  const chat = toChat(res.data)
  rememberPeople(peopleInChat(chat))
  return chat
}

export async function fetchUnreadSummary(): Promise<number> {
  const res = await apiClient.get<{ total_unread?: number }>(ENDPOINTS.chats.unreadSummary)
  return res.data.total_unread ?? 0
}

/** Idempotent — answers the existing chat when there already is one. */
export async function openDirectChat(
  talkUserId: Id,
): Promise<{ chatId: Id; created: boolean }> {
  const res = await apiClient.post<{ chat_id: number; created?: boolean }>(
    ENDPOINTS.chats.direct,
    { talk_user_id: talkUserId },
  )
  return { chatId: res.data.chat_id, created: res.data.created ?? false }
}

export async function createGroup(input: CreateGroupInput): Promise<{ chatId: Id }> {
  const res = await apiClient.post<{ chat_id?: number; id?: number }>(ENDPOINTS.chats.group, {
    name: input.name,
    description: input.description ?? undefined,
    avatar_url: input.avatarUrl ?? undefined,
    company_id: input.companyId ?? undefined,
    talk_user_ids: input.talkUserIds,
  })
  return { chatId: res.data.chat_id ?? res.data.id ?? 0 }
}

/** Rename / re-describe / re-picture a group. Owner only, groups only. */
export async function updateChat(chatId: Id, input: UpdateChatInput): Promise<void> {
  await apiClient.patch(
    ENDPOINTS.chats.update(chatId),
    params({
      name: input.name,
      description: input.description,
      avatar_url: input.avatarUrl,
    }),
  )
}

/** Disband a group for EVERYONE. Owner only, and the only such deletion in Talk. */
export async function disbandChat(chatId: Id): Promise<void> {
  await apiClient.delete(ENDPOINTS.chats.disband(chatId))
}

/**
 * Hide chats from MY list. DIRECT chats only — the API refuses a group with a
 * 400 naming the offending ids, so the UI filters groups out before calling.
 */
export async function deleteChatsForMe(chatIds: Id[]): Promise<void> {
  await apiClient.post(ENDPOINTS.chats.delete, { chat_ids: chatIds })
}

/**
 * Mark chats read — one or fifty, one statement either way.
 *
 * This clears my badge AND turns the senders' ticks blue. Without
 * `uptoMessageId` it means each chat's newest message, which is what "mark as
 * read" means.
 */
export async function markChatsRead(chatIds: Id[], uptoMessageId?: Id): Promise<void> {
  await apiClient.post(
    ENDPOINTS.chats.read,
    params({ chat_ids: chatIds, upto_message_id: uptoMessageId }),
  )
}

/** Pin a chat in MY list. Entirely private — nobody else's view changes. */
export async function setChatPinned(chatId: Id, pinned: boolean): Promise<void> {
  await apiClient.put(ENDPOINTS.chats.pin(chatId), { pinned })
}

/** Upload a group picture and save it. Owner only for both halves. */
export async function uploadChatAvatar(chatId: Id, file: File): Promise<string> {
  const key = await uploadFile(ENDPOINTS.chats.avatarPresign(chatId), file, {
    allowed: AVATAR_CONTENT_TYPES,
    // The avatar presign takes no size field, unlike the attachment one.
    withSize: false,
  })
  await updateChat(chatId, { avatarUrl: key })
  return key
}

/* ---------------------------------------------------------------- */
/* Members                                                           */
/* ---------------------------------------------------------------- */

export async function fetchMembers(chatId: Id): Promise<ChatMember[]> {
  const res = await apiClient.get<{ items: ChatMemberDto[] }>(ENDPOINTS.members.list(chatId))
  const items = (res.data.items ?? []).map(toChatMember)
  rememberPeople(items.flatMap(peopleInMember))
  return items
}

/** Owner only. Ids that aren't Talk identities of this account are dropped. */
export async function addMembers(chatId: Id, talkUserIds: Id[]): Promise<void> {
  await apiClient.post(ENDPOINTS.members.add(chatId), { talk_user_ids: talkUserIds })
}

/** Anyone may leave — except the owner, who disbands instead. */
export async function leaveChat(chatId: Id): Promise<void> {
  await apiClient.post(ENDPOINTS.members.leave(chatId))
}

export async function removeMember(chatId: Id, talkUserId: Id): Promise<void> {
  await apiClient.delete(ENDPOINTS.members.remove(chatId, talkUserId))
}

/**
 * The group owner's block: the member stays and keeps reading, and loses only
 * the ability to post. Deliberately not a removal — their app shows the chat.
 */
export async function setMemberBlocked(
  chatId: Id,
  talkUserId: Id,
  blocked: boolean,
): Promise<void> {
  await apiClient.put(ENDPOINTS.members.block(chatId, talkUserId), { blocked })
}

/* ---------------------------------------------------------------- */
/* Messages                                                          */
/* ---------------------------------------------------------------- */

/**
 * One page of history, newest-first from the server — reversed here so the
 * cache and the list both work oldest-first.
 *
 * Two cursors, two jobs. `beforeId` scrolls UP through history; `afterId`
 * CATCHES UP after a reconnect, replaying the gap. Never both.
 */
export async function fetchMessages(
  chatId: Id,
  { beforeId, afterId, limit = MESSAGE_PAGE_SIZE }: {
    beforeId?: Id
    afterId?: Id
    limit?: number
  } = {},
): Promise<MessagePage<ChatMessage>> {
  const res = await apiClient.get<{ items: MessageDto[] }>(ENDPOINTS.messages.list(chatId), {
    params: params({ limit, before_id: beforeId, after_id: afterId }),
  })
  const newestFirst = res.data.items ?? []
  const items = [...newestFirst].reverse().map(toChatMessage)
  rememberPeople(items.flatMap(peopleInMessage))
  return {
    items,
    oldestId: items[0]?.id ?? null,
    newestId: items[items.length - 1]?.id ?? null,
    // A short page proves we reached the end; a full one only suggests more.
    hasMore: newestFirst.length >= limit,
  }
}

/**
 * Send.
 *
 * `client_message_id` makes this IDEMPOTENT — retrying with the same value
 * answers the SAME message instead of posting a second bubble. It is the single
 * most visible bug a chat can have and the server can only prevent it if we
 * supply the id, so it is required by `SendMessageInput` rather than optional.
 */
export async function sendMessage(input: SendMessageInput): Promise<ChatMessage> {
  const res = await apiClient.post<MessageDto>(
    ENDPOINTS.messages.send(input.chatId),
    params({
      body: input.body?.trim() || undefined,
      media: input.media?.length ? input.media.map(toOutgoingMediaDto) : undefined,
      reply_to_message_id: input.replyToMessageId ?? undefined,
      client_message_id: input.clientMessageId,
    }),
  )
  const message = toChatMessage(res.data)
  rememberPeople(peopleInMessage(message))
  return message
}

function toOutgoingMediaDto(media: OutgoingMedia) {
  return params({
    kind: media.kind,
    file_url: media.fileUrl,
    file_name: media.fileName ?? undefined,
    mime_type: media.mimeType ?? undefined,
    size_bytes: media.sizeBytes ?? undefined,
    width: media.width ?? undefined,
    height: media.height ?? undefined,
    duration_seconds: media.durationSeconds ?? undefined,
    thumbnail_url: media.thumbnailUrl ?? undefined,
  })
}

/** Sender only — not the owner, whose authority is over membership. */
export async function editMessage(
  chatId: Id,
  messageId: Id,
  body: string,
): Promise<ChatMessage> {
  const res = await apiClient.patch<MessageDto>(ENDPOINTS.messages.edit(chatId, messageId), {
    body,
  })
  const message = toChatMessage(res.data)
  rememberPeople(peopleInMessage(message))
  return message
}

/**
 * Both deletes, chosen by `forEveryone`.
 *
 * FOR ME (default) hides them from me alone and is deliberately SILENT — no
 * event fires, because the other party must never learn you hid their message.
 * FOR EVERYONE leaves a tombstone and does emit `talk.message.deleted`.
 */
export async function deleteMessages(
  chatId: Id,
  messageIds: Id[],
  forEveryone = false,
): Promise<void> {
  await apiClient.post(ENDPOINTS.messages.delete(chatId), {
    message_ids: messageIds,
    for_everyone: forEveryone,
  })
}

/** Pins at the top of the thread for EVERYONE — not the same as pinning a chat. */
export async function setMessagePinned(
  chatId: Id,
  messageId: Id,
  pinned: boolean,
  expiresAt?: string,
): Promise<void> {
  await apiClient.put(
    ENDPOINTS.messages.pin(chatId, messageId),
    params({ pinned, expires_at: expiresAt }),
  )
}

/** The pin bar: live, unexpired pins, newest first. */
export async function fetchPins(chatId: Id): Promise<PinnedMessage[]> {
  const res = await apiClient.get<{ items: PinnedMessageDto[] }>(
    ENDPOINTS.messages.pins(chatId),
  )
  const items = (res.data.items ?? []).map(toPinnedMessage)
  rememberPeople(items.flatMap(peopleInPin))
  return items
}

/**
 * The "message info" sheet. SENDER only — a non-sender gets a 404, not a 403,
 * because read state is the sender's information.
 */
export async function fetchReceipts(chatId: Id, messageId: Id): Promise<MessageReceipt[]> {
  const res = await apiClient.get<{ items: MessageReceiptDto[] }>(
    ENDPOINTS.messages.receipts(chatId, messageId),
  )
  const items = (res.data.items ?? []).map(toMessageReceipt)
  rememberPeople(items.flatMap(peopleInReceipt))
  return items
}

/** The media gallery — every attachment in one chat, newest first. */
export async function fetchChatMedia(
  chatId: Id,
  { kind, limit = 40, offset = 0 }: { kind?: MediaKind; limit?: number; offset?: number } = {},
): Promise<ListPage<MessageMedia>> {
  const res = await apiClient.get<{ items: MessageMediaDto[]; total: number }>(
    ENDPOINTS.messages.media(chatId),
    { params: params({ kind, limit, offset }) },
  )
  return { items: (res.data.items ?? []).map(toMessageMedia), total: res.data.total ?? 0 }
}

/**
 * Upload one attachment and answer the key to send as `media[].file_url`.
 *
 * The presign is refused for the same reasons a send is — you left, were removed,
 * were blocked from posting — so resolve those before showing a file picker.
 */
export async function uploadAttachment(
  chatId: Id,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  return uploadFile(ENDPOINTS.messages.mediaPresign(chatId), file, {
    allowed: ATTACHMENT_CONTENT_TYPES,
    onProgress,
  })
}

/** A forward is a NEW message, not a pointer — the destination can't see the source. */
export async function forwardMessages(messageIds: Id[], toChatIds: Id[]): Promise<void> {
  await apiClient.post(ENDPOINTS.messages.forward, {
    message_ids: messageIds,
    to_chat_ids: toChatIds,
  })
}

/** Full-text search, inside one chat or across every chat I am in. */
export async function searchMessages({
  q,
  chatId,
  limit = 30,
  offset = 0,
}: {
  q: string
  chatId?: Id
  limit?: number
  offset?: number
}): Promise<ListPage<MessageSearchHit>> {
  const res = await apiClient.get<{ items: MessageSearchHitDto[]; total: number }>(
    ENDPOINTS.messages.search,
    { params: params({ q, chat_id: chatId, limit, offset }) },
  )
  const items = (res.data.items ?? []).map(toMessageSearchHit)
  rememberPeople(items.flatMap(peopleInSearchHit))
  return { items, total: res.data.total ?? 0 }
}

/* ---------------------------------------------------------------- */
/* Blocks, presence, typing                                          */
/* ---------------------------------------------------------------- */

/**
 * My private, account-wide block in direct chats. DIRECTED and never disclosed:
 * the other person is not told, and it survives the chat being deleted.
 */
export async function setPersonBlocked(talkUserId: Id, blocked: boolean): Promise<void> {
  await apiClient.put(ENDPOINTS.blocks, { talk_user_id: talkUserId, blocked })
}

/** My own block list. It never reports who has blocked ME. */
export async function fetchBlocks(): Promise<BlockedPerson[]> {
  const res = await apiClient.get<{ items: BlockedPersonDto[] }>(ENDPOINTS.blocks)
  const items = (res.data.items ?? []).map(toBlockedPerson)
  rememberPeople(items.flatMap(peopleInBlock))
  return items
}

export async function fetchPresence(talkUserIds: Id[]): Promise<Presence[]> {
  if (talkUserIds.length === 0) return []
  const res = await apiClient.get<{ items: PresenceDto[] }>(ENDPOINTS.presence, {
    params: { talk_user_ids: talkUserIds.join(',') },
  })
  const items = (res.data.items ?? []).map(toPresence)
  rememberPeople(items.flatMap(peopleInPresence))
  return items
}

/** Everyone in one chat, so a client needn't list members then ask separately. */
export async function fetchChatPresence(chatId: Id): Promise<Presence[]> {
  const res = await apiClient.get<{ items: PresenceDto[] }>(ENDPOINTS.chats.presence(chatId))
  const items = (res.data.items ?? []).map(toPresence)
  // The one read that names EVERY person in a chat in a single request — the
  // member sheet's dots and the typing indicator's names come from here.
  rememberPeople(items.flatMap(peopleInPresence))
  return items
}

/**
 * The HTTP typing fallback, for a client with no socket. It costs a round trip
 * and a membership query, so `emitTyping` from `lib/socket-client` is preferred
 * and this exists only for the no-realtime deployment.
 */
export async function sendTypingOverHttp(chatId: Id, typing: boolean): Promise<void> {
  await apiClient.post(ENDPOINTS.chats.typing(chatId), { typing })
}
