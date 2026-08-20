import { apiClient } from '@/lib/api-client'
import { SocketAckError } from '@/lib/api-error'
import { ENDPOINTS } from '@/lib/endpoints'
import { canSendOverSocket, joinChatRoom, socketCall } from '@/lib/socket-client'
import { ATTACHMENT_CONTENT_TYPES, AVATAR_CONTENT_TYPES, uploadFile } from '@/lib/uploads'
import { rememberPeople } from '@/stores/talk-directory-store'
import type { Id, ListPage, MessagePage } from '@/types/api'
import {
  CHAT_PAGE_SIZE,
  CONTACT_PAGE_SIZE,
  MESSAGE_PAGE_SIZE,
  PIN_PAGE_SIZE,
  SOCKET_ACTIONS,
} from '../constants'
import {
  toBlockedPerson,
  toChat,
  toChatMember,
  toChatMessage,
  toContact,
  toMessageMedia,
  toMessageReceipt,
  toMessageSearchHit,
  toPinnedMessage,
  toPresence,
  type BlockedPersonDto,
  type ChatDto,
  type ChatMemberDto,
  type ContactDto,
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
  peopleInContact,
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
  Contact,
  ContactQuery,
  CreateGroupInput,
  MediaKind,
  MessageMedia,
  MessageReceipt,
  MessageSearchHit,
  OutgoingMedia,
  PinnedMessage,
  PinScope,
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
/* Writes: the socket when it is live, HTTP when it is not           */
/* ---------------------------------------------------------------- */

/**
 * Run a write over whichever transport is available.
 *
 * These are the SAME code path on the server: the gateway holds no database, so
 * an inbound event is the REST route one hop away, called with our own bearer
 * token, and the ack carries that route's status and body verbatim. So the
 * socket is preferred — one transport for the gesture and its consequence, one
 * failure mode, no round trip through a second connection — and HTTP is not a
 * degraded fallback but the identical operation.
 *
 * `overHttp` runs when there is no live socket (a deployment with no realtime
 * service, or a moment mid-reconnect) and when the emit failed for TRANSPORT
 * reasons — no ack, or the socket dropped in flight. A refusal the route
 * actually issued (`403`, `404`, `409`, …) is thrown as-is: replaying it over
 * HTTP would only be told the same thing.
 */
async function write<TAck, TResult>(
  event: string,
  payload: Record<string, unknown>,
  fromAck: (data: TAck) => TResult,
  overHttp: () => Promise<TResult>,
): Promise<TResult> {
  if (!canSendOverSocket()) return overHttp()
  try {
    return fromAck(await socketCall<TAck>(event, params(payload)))
  } catch (error) {
    if (error instanceof SocketAckError && error.status === 0) return overHttp()
    throw error
  }
}

/* ---------------------------------------------------------------- */
/* Contacts — the directory                                          */
/* ---------------------------------------------------------------- */

/**
 * People I may start a chat with, alphabetically.
 *
 * `search` must be server-side: this pages, so filtering the page in the browser
 * would search the thirty rows we happen to hold rather than the organisation.
 *
 * Reach is read LIVE per request and is granted, never assumed — an empty list
 * means an administrator has granted me nobody, not that the read failed.
 */
export async function fetchContacts(query: ContactQuery = {}): Promise<ListPage<Contact>> {
  const res = await apiClient.get<{ items: ContactDto[]; total: number }>(ENDPOINTS.contacts, {
    params: params({
      search: query.search?.trim() || undefined,
      company_id: query.companyId,
      department_id: query.departmentId,
      limit: query.limit ?? CONTACT_PAGE_SIZE,
      offset: query.offset ?? 0,
    }),
  })
  const items = (res.data.items ?? []).map(toContact)
  // The one read that names people we have never messaged — so typing and
  // presence can print a name for someone whose first message is still to come.
  rememberPeople(items.flatMap(peopleInContact))
  return { items, total: res.data.total ?? 0 }
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

/**
 * Subscribe to a chat AND read it in ONE round trip.
 *
 * `talk:join` with `with_chat` answers the same body `GET /talk/chats/:id`
 * would, built from our own side, so opening a conversation costs one hop
 * instead of two. Three ways it can come back short, and all three mean the
 * same thing to a caller — read it over HTTP instead:
 *
 *  - no live socket at all;
 *  - the join was REFUSED (`ok: false`), which means the grant lapsed: a read
 *    re-issues it, and `joinAll` retries the join afterwards;
 *  - the join stood but the read behind it failed, so the ack carried no `chat`.
 */
export async function joinAndReadChat(chatId: Id): Promise<Chat | null> {
  if (!canSendOverSocket()) return null
  const { chat } = await joinChatRoom(chatId, true)
  if (!chat) return null
  const mapped = toChat(chat as ChatDto)
  rememberPeople(peopleInChat(mapped))
  return mapped
}

export async function fetchUnreadSummary(): Promise<number> {
  const res = await apiClient.get<{ total_unread?: number }>(ENDPOINTS.chats.unreadSummary)
  return res.data.total_unread ?? 0
}

/**
 * Idempotent — answers the existing chat when there already is one, which is
 * why tapping a contact never has to know whether it is the first time.
 */
export async function openDirectChat(
  talkUserId: Id,
): Promise<{ chatId: Id; created: boolean }> {
  type Ack = { chat_id: number; created?: boolean }
  return write<Ack, { chatId: Id; created: boolean }>(
    SOCKET_ACTIONS.chatCreateDirect,
    { talk_user_id: talkUserId },
    (data) => ({ chatId: data.chat_id, created: data.created ?? false }),
    async () => {
      const res = await apiClient.post<Ack>(ENDPOINTS.chats.direct, {
        talk_user_id: talkUserId,
      })
      return { chatId: res.data.chat_id, created: res.data.created ?? false }
    },
  )
}

export async function createGroup(input: CreateGroupInput): Promise<{ chatId: Id }> {
  type Ack = { chat_id?: number; id?: number }
  const body = {
    name: input.name,
    description: input.description ?? undefined,
    avatar_url: input.avatarUrl ?? undefined,
    company_id: input.companyId ?? undefined,
    talk_user_ids: input.talkUserIds,
  }
  return write<Ack, { chatId: Id }>(
    SOCKET_ACTIONS.chatCreateGroup,
    body,
    (data) => ({ chatId: data.chat_id ?? data.id ?? 0 }),
    async () => {
      const res = await apiClient.post<Ack>(ENDPOINTS.chats.group, params(body))
      return { chatId: res.data.chat_id ?? res.data.id ?? 0 }
    },
  )
}

/** Rename / re-describe / re-picture a group. Owner only, groups only. */
export async function updateChat(chatId: Id, input: UpdateChatInput): Promise<void> {
  const changes = {
    name: input.name,
    description: input.description,
    avatar_url: input.avatarUrl,
  }
  await write<unknown, void>(
    SOCKET_ACTIONS.chatUpdate,
    { chat_id: chatId, ...changes },
    () => undefined,
    async () => {
      await apiClient.patch(ENDPOINTS.chats.update(chatId), params(changes))
    },
  )
}

/** Disband a group for EVERYONE. Owner only, and the only such deletion in Talk. */
export async function disbandChat(chatId: Id): Promise<void> {
  await write<unknown, void>(
    SOCKET_ACTIONS.chatDelete,
    { chat_id: chatId },
    () => undefined,
    async () => {
      await apiClient.delete(ENDPOINTS.chats.disband(chatId))
    },
  )
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
 * read" means — and that is the only correct form for a bulk "mark all read",
 * because one id applies to EVERY chat named in the call.
 *
 * The server now CLAMPS `uptoMessageId` to a message of the named chat, so an id
 * from another thread can no longer park a read frontier past ids that do not
 * exist yet and pin the chat at zero unread for good. Send an id that belongs to
 * the chat anyway: clamping is a backstop, not a feature.
 */
export async function markChatsRead(chatIds: Id[], uptoMessageId?: Id): Promise<void> {
  await write<unknown, void>(
    SOCKET_ACTIONS.messageRead,
    { chat_ids: chatIds, upto_message_id: uptoMessageId },
    () => undefined,
    async () => {
      await apiClient.post(
        ENDPOINTS.chats.read,
        params({ chat_ids: chatIds, upto_message_id: uptoMessageId }),
      )
    },
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
  await write<unknown, void>(
    SOCKET_ACTIONS.memberAdd,
    { chat_id: chatId, talk_user_ids: talkUserIds },
    () => undefined,
    async () => {
      await apiClient.post(ENDPOINTS.members.add(chatId), { talk_user_ids: talkUserIds })
    },
  )
}

/** Anyone may leave — except the owner, who disbands instead. */
export async function leaveChat(chatId: Id): Promise<void> {
  await write<unknown, void>(
    SOCKET_ACTIONS.memberLeave,
    { chat_id: chatId },
    () => undefined,
    async () => {
      await apiClient.post(ENDPOINTS.members.leave(chatId))
    },
  )
}

export async function removeMember(chatId: Id, talkUserId: Id): Promise<void> {
  await write<unknown, void>(
    SOCKET_ACTIONS.memberRemove,
    { chat_id: chatId, talk_user_id: talkUserId },
    () => undefined,
    async () => {
      await apiClient.delete(ENDPOINTS.members.remove(chatId, talkUserId))
    },
  )
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
  await write<unknown, void>(
    SOCKET_ACTIONS.memberBlock,
    { chat_id: chatId, talk_user_id: talkUserId, blocked },
    () => undefined,
    async () => {
      await apiClient.put(ENDPOINTS.members.block(chatId, talkUserId), { blocked })
    },
  )
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
 *
 * Sending to somebody who has BLOCKED me SUCCEEDS — the message is stored and
 * acknowledged like any other, it simply never reaches them. So a send result
 * says nothing about who blocked me, and nothing here may infer it. The only
 * refusal left is the other direction: a 403 when *I* blocked *them*.
 */
export async function sendMessage(input: SendMessageInput): Promise<ChatMessage> {
  const body = {
    body: input.body?.trim() || undefined,
    media: input.media?.length ? input.media.map(toOutgoingMediaDto) : undefined,
    reply_to_message_id: input.replyToMessageId ?? undefined,
    client_message_id: input.clientMessageId,
  }

  const received = (dto: MessageDto) => {
    const message = toChatMessage(dto)
    rememberPeople(peopleInMessage(message))
    return message
  }

  // The bytes never travel here either way — they went straight to storage
  // during the presign, and `media[].file_url` is the key that came back.
  return write<MessageDto, ChatMessage>(
    SOCKET_ACTIONS.messageSend,
    { chat_id: input.chatId, ...body },
    received,
    async () => {
      const res = await apiClient.post<MessageDto>(
        ENDPOINTS.messages.send(input.chatId),
        params(body),
      )
      return received(res.data)
    },
  )
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

/**
 * Sender only — not the owner, whose authority is over membership.
 *
 * The two transports answer different shapes for this one: HTTP returns the
 * whole message, the ack returns `{ message_id, edited_at }`. Both are narrowed
 * to what an edit actually changes, so the caller does not have to care.
 */
export interface EditedMessage {
  messageId: Id
  body: string | null
  editedAt: string
}

export async function editMessage(
  chatId: Id,
  messageId: Id,
  body: string,
): Promise<EditedMessage> {
  type Ack = { message_id?: number; edited_at?: string }
  return write<Ack, EditedMessage>(
    SOCKET_ACTIONS.messageEdit,
    { chat_id: chatId, message_id: messageId, body },
    (data) => ({
      messageId: data.message_id ?? messageId,
      body,
      editedAt: data.edited_at ?? new Date().toISOString(),
    }),
    async () => {
      const res = await apiClient.patch<MessageDto>(ENDPOINTS.messages.edit(chatId, messageId), {
        body,
      })
      const message = toChatMessage(res.data)
      rememberPeople(peopleInMessage(message))
      return {
        messageId: message.id,
        body: message.body,
        editedAt: message.editedAt ?? new Date().toISOString(),
      }
    },
  )
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
  await write<unknown, void>(
    SOCKET_ACTIONS.messageDelete,
    { chat_id: chatId, message_ids: messageIds, for_everyone: forEveryone },
    () => undefined,
    async () => {
      await apiClient.post(ENDPOINTS.messages.delete(chatId), {
        message_ids: messageIds,
        for_everyone: forEveryone,
      })
    },
  )
}

/**
 * Pin a message — for the whole chat, or only for me.
 *
 * `forEveryone: true` is the announcement bar every participant sees.
 * `forEveryone: false` is a PRIVATE bookmark: nobody else's view changes, nobody
 * else is notified, and it neither sets nor clears the chat-wide pin. The two
 * are separate storage, so the same message can carry both.
 *
 * It is sent explicitly in both directions because the server DEFAULTS to
 * `true` — a private pin that forgot the flag would pin for the whole chat.
 *
 * `expiresAt` behaves the same either way, and both kinds are IDEMPOTENT:
 * re-pinning is how an expiry is extended. A private pin needs only MEMBERSHIP,
 * so it is offered in a group you have left or one you are muted in, where the
 * chat-wide pin is refused.
 */
export async function setMessagePinned(
  chatId: Id,
  messageId: Id,
  pinned: boolean,
  { expiresAt, forEveryone = true }: { expiresAt?: string; forEveryone?: boolean } = {},
): Promise<void> {
  // One event for all four outcomes: `pinned` picks the direction and
  // `for_everyone` picks the audience, so the room hears
  // `talk.message.pinned`/`unpinned` or my other devices hear
  // `talk.message.self_pinned`/`self_unpinned`.
  await write<unknown, void>(
    SOCKET_ACTIONS.messagePin,
    {
      chat_id: chatId,
      message_id: messageId,
      pinned,
      for_everyone: forEveryone,
      expires_at: expiresAt,
    },
    () => undefined,
    async () => {
      await apiClient.put(
        ENDPOINTS.messages.pin(chatId, messageId),
        params({ pinned, for_everyone: forEveryone, expires_at: expiresAt }),
      )
    },
  )
}

/**
 * The pinned messages of a chat: live, unexpired pins, newest PIN first — the
 * order is when somebody decided a message mattered, not when it was written.
 *
 * Each row carries the message itself, so the sheet renders in one call. It obeys
 * MY history exactly as the thread does: a pin whose message I deleted for
 * myself, or which sits before I cleared the chat, or which was written while I
 * had the sender blocked, is absent from both the page and `total` — even for a
 * chat-wide pin, and even for one I set myself.
 *
 * `scope` picks the audience: `everyone` for the chat-wide bar, `me` for my
 * private bookmarks, `all` for both. Under `all` a message pinned BOTH ways
 * comes back TWICE — two rows, two pinners, two expiries — so a caller keys on
 * the pair rather than on the message id.
 */
export async function fetchPins(
  chatId: Id,
  query: { scope?: PinScope; limit?: number; offset?: number } = {},
): Promise<ListPage<PinnedMessage>> {
  const res = await apiClient.get<{ items: PinnedMessageDto[]; total: number }>(
    ENDPOINTS.messages.pins(chatId),
    {
      params: params({
        // Sent always: the server defaults to `everyone`, so the private
        // bookmarks would simply be missing from a read that left it off.
        scope: query.scope ?? 'everyone',
        limit: query.limit ?? PIN_PAGE_SIZE,
        offset: query.offset ?? 0,
      }),
    },
  )
  const items = (res.data.items ?? []).map(toPinnedMessage)
  rememberPeople(items.flatMap(peopleInPin))
  return { items, total: res.data.total ?? items.length }
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
  // Each destination gets its own `talk.message.new`, so a forward into a chat
  // we are looking at appears there without a re-read.
  await write<unknown, void>(
    SOCKET_ACTIONS.messageForward,
    { message_ids: messageIds, to_chat_ids: toChatIds },
    () => undefined,
    async () => {
      await apiClient.post(ENDPOINTS.messages.forward, {
        message_ids: messageIds,
        to_chat_ids: toChatIds,
      })
    },
  )
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
 * the other person is not told — on the block OR the unblock — and it survives
 * the chat being deleted.
 *
 * It is an INTERVAL, not a switch. `blocked: false` closes the window and hands
 * nothing back: messages written while it stood stay hidden from me for good, in
 * the thread, search, the gallery, the pins, the preview and every unread count.
 * So there is no backlog to offer and no "load what I missed" to build.
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
