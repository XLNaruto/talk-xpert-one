import { useEffect, useRef } from 'react'
import { connectSocket, onSocketConnected } from '@/lib/socket-client'
import { logger } from '@/lib/logger'
import { useAuthStore } from '@/stores/auth-store'
import { useChatListStore, cachedChat } from '@/stores/chat-list-store'
import { useChatStore, activeChatId } from '@/stores/chat-store'
import { useMessageCacheStore } from '@/stores/message-cache-store'
import { knownPerson, rememberPeople } from '@/stores/talk-directory-store'
import type { Id } from '@/types/api'
import { SOCKET_EVENTS, TYPING_EXPIRY_MS } from '../constants'
import { toChatMessage, type MessageDto } from '../lib/chat-mappers'
import { peopleInMessage } from '../lib/talk-directory'
import { catchUpMessages } from '../api/use-messages'
import * as chatApi from '../api/chat-api'
import { joinAll } from '../api/use-chats'

/**
 * The realtime subscription.
 *
 * Mounted EXACTLY ONCE, by `chat-layout.tsx`. The socket is a singleton whose
 * rooms are addressed to the person rather than to a screen, so a second mount
 * would bind a second set of handlers and process every event twice.
 *
 * The sidebar and the thread both need the same events — `talk.message.new`
 * updates a list preview and unread badge AND appends to the open thread — so
 * everything is handled here and demultiplexed on `chat_id`.
 */
export function useMessageStream() {
  const talkUserId = useAuthStore((s) => s.identity?.talkUserId)

  // Handlers read live state through the stores rather than through closures, so
  // this effect can depend on the identity alone and never rebind mid-session.
  const selfId = useRef<Id | null>(null)
  selfId.current = talkUserId ?? null

  useEffect(() => {
    if (talkUserId == null) return
    // Null when this deployment reports no realtime service — nothing to bind.
    const socket = connectSocket()
    if (!socket) return

    const cache = useMessageCacheStore.getState
    const list = useChatListStore.getState
    const ui = useChatStore.getState

    /* ---- messages ---- */

    const onMessageNew = (payload: { chat_id: number; message: MessageDto }) => {
      if (!payload?.message) return
      const message = toChatMessage(payload.message)
      const chatId = payload.chat_id ?? message.chatId
      const isMine = message.senderTalkUserId === selfId.current

      // The event carries `sender_name` and `sender_photo`, so a person we have
      // never seen before is named the moment they first speak.
      rememberPeople(peopleInMessage(message))

      // We receive an echo of our OWN sends, because our socket is in the room.
      // The cache merges by id and by `clientMessageId`, so this reconciles the
      // optimistic bubble instead of appending a duplicate — and a message sent
      // on another device of ours still appears here.
      cache().upsertOne(chatId, message)

      const isOpen = activeChatId() === chatId
      list().applyIncoming(chatId, {
        preview: message.body,
        at: message.createdAt,
        senderTalkUserId: message.senderTalkUserId,
        senderName: message.senderName,
        senderPhoto: message.senderPhoto,
        countsAsUnread: !isMine && !isOpen,
      })

      // A message for a chat we don't hold means we were just added and the list
      // is stale. Re-read it so the row exists (and its grant is refreshed).
      if (!cachedChat(chatId)) void refreshList()

      // Reading a thread that is open should clear its badge immediately, or the
      // count creeps up while the user is looking straight at the message.
      if (isOpen && !isMine) {
        void chatApi.markChatsRead([chatId], message.id).catch(() => undefined)
        list().clearUnread(chatId)
      }

      // Anyone who sent a message has plainly stopped typing.
      if (message.senderTalkUserId !== null) {
        ui().stopTyping(chatId, message.senderTalkUserId)
      }
    }

    const onMessageEdited = (payload: {
      chat_id: number
      message_id: number
      body: string | null
      edited_at: string
    }) => {
      cache().applyEdit(
        payload.chat_id,
        payload.message_id,
        payload.body ?? null,
        payload.edited_at,
      )
      // The preview only changes when the edited message was the LAST one.
      const chat = cachedChat(payload.chat_id)
      if (chat && isLastMessage(payload.chat_id, payload.message_id)) {
        list().applyIncoming(payload.chat_id, {
          preview: payload.body ?? null,
          at: chat.lastMessageAt ?? payload.edited_at,
          senderTalkUserId: chat.lastMessageSenderTalkUserId,
          senderName: chat.lastMessageSenderName,
          senderPhoto: chat.lastMessageSenderPhoto,
          countsAsUnread: false,
        })
      }
    }

    const onMessageDeleted = (payload: { chat_id: number; message_ids: number[] }) => {
      const ids = payload.message_ids ?? []
      // Delete for EVERYONE keeps the bubble as a tombstone — replies point at it.
      cache().applyDeleteForEveryone(payload.chat_id, ids)
      const chat = cachedChat(payload.chat_id)
      if (chat && ids.some((id) => isLastMessage(payload.chat_id, id))) {
        list().applyIncoming(payload.chat_id, {
          preview: null,
          at: chat.lastMessageAt ?? new Date().toISOString(),
          senderTalkUserId: chat.lastMessageSenderTalkUserId,
          senderName: chat.lastMessageSenderName,
          senderPhoto: chat.lastMessageSenderPhoto,
          countsAsUnread: false,
        })
      }
    }

    const onMessageRead = (payload: {
      chat_id: number
      message_ids: number[]
      by_talk_user_id: number
    }) => {
      // Somebody else read MY messages: this is what turns my ticks blue. My own
      // read of their messages tells me nothing, so it is ignored.
      if (payload.by_talk_user_id === selfId.current) return
      cache().applyRead(payload.chat_id, payload.message_ids ?? [])
    }

    const onMessagePinned = (payload: { chat_id: number; message_id: number }) => {
      cache().applyPinned(payload.chat_id, payload.message_id, true)
    }

    const onMessageUnpinned = (payload: { chat_id: number; message_id: number }) => {
      cache().applyPinned(payload.chat_id, payload.message_id, false)
    }

    /* ---- chats and members ---- */

    const onChatCreated = () => {
      // The event carries only an id, a type and maybe a name — not enough to
      // draw a row — so the list is re-read, which also issues the new grant.
      void refreshList()
    }

    const onChatUpdated = (payload: {
      chat_id: number
      name?: string | null
      description?: string | null
      avatar_url?: string | null
    }) => {
      list().applyChatUpdated(payload.chat_id, {
        name: payload.name,
        description: payload.description,
        avatarUrl: payload.avatar_url,
      })
    }

    const onChatDeleted = (payload: { chat_id: number }) => {
      forgetChat(payload.chat_id)
    }

    const onMemberAdded = (payload: { chat_id: number; talk_user_ids: number[] }) => {
      // Membership drives the member sheet and the group's member count, both of
      // which the server owns — so re-read the header rather than guess at it.
      void refreshChat(payload.chat_id)
    }

    const onMemberLeft = (payload: { chat_id: number; talk_user_id: number }) => {
      if (payload.talk_user_id === selfId.current) {
        list().setSelfLeft(payload.chat_id)
        return
      }
      void refreshChat(payload.chat_id)
    }

    const onMemberRemoved = (payload: { chat_id: number; talk_user_id: number }) => {
      // We are told just BEFORE the removal takes effect — afterwards we would no
      // longer be in the fan-out and would never learn of it.
      if (payload.talk_user_id === selfId.current) {
        forgetChat(payload.chat_id)
        return
      }
      void refreshChat(payload.chat_id)
    }

    const onMemberBlocked = (payload: {
      chat_id: number
      talk_user_id: number
      blocked: boolean
    }) => {
      if (payload.talk_user_id === selfId.current) {
        // Disable the composer, keep the chat readable — that is the whole point
        // of the owner's block, as against a removal.
        list().setSelfBlocked(payload.chat_id, payload.blocked)
        return
      }
      void refreshChat(payload.chat_id)
    }

    /* ---- typing and presence ---- */

    const onTypingStart = (payload: { chat_id: number; talk_user_id: number }) => {
      // The expiry is set here rather than trusted from a later `stop`: a client
      // that crashes mid-sentence never sends one.
      ui().startTyping(payload.chat_id, payload.talk_user_id, Date.now() + TYPING_EXPIRY_MS)
    }

    const onTypingStop = (payload: { chat_id: number; talk_user_id: number }) => {
      ui().stopTyping(payload.chat_id, payload.talk_user_id)
    }

    const onPresence = (payload: {
      talk_user_id: number
      is_online: boolean
      at?: string
    }) => {
      // The one Talk event broadcast to the WHOLE account, because the gateway
      // holds no database and cannot work out who shares a chat with whom. So it
      // is filtered here — otherwise the store fills with colleagues we have
      // never messaged.
      if (!isDisplayed(payload.talk_user_id)) return
      // The event is an id and a flag — no name, no photo — so the label comes
      // from whatever named this person earlier. Overwriting a row with nulls
      // here would blank the member sheet every time somebody went offline.
      const known = knownPerson(payload.talk_user_id)
      ui().applyPresence([
        {
          talkUserId: payload.talk_user_id,
          name: known?.name ?? null,
          photo: known?.photo ?? null,
          isOnline: payload.is_online,
          lastSeenAt: payload.at ?? null,
        },
      ])
    }

    socket.on(SOCKET_EVENTS.messageNew, onMessageNew)
    socket.on(SOCKET_EVENTS.messageEdited, onMessageEdited)
    socket.on(SOCKET_EVENTS.messageDeleted, onMessageDeleted)
    socket.on(SOCKET_EVENTS.messageRead, onMessageRead)
    socket.on(SOCKET_EVENTS.messagePinned, onMessagePinned)
    socket.on(SOCKET_EVENTS.messageUnpinned, onMessageUnpinned)
    socket.on(SOCKET_EVENTS.chatCreated, onChatCreated)
    socket.on(SOCKET_EVENTS.chatUpdated, onChatUpdated)
    socket.on(SOCKET_EVENTS.chatDeleted, onChatDeleted)
    socket.on(SOCKET_EVENTS.memberAdded, onMemberAdded)
    socket.on(SOCKET_EVENTS.memberLeft, onMemberLeft)
    socket.on(SOCKET_EVENTS.memberRemoved, onMemberRemoved)
    socket.on(SOCKET_EVENTS.memberBlocked, onMemberBlocked)
    socket.on(SOCKET_EVENTS.typingStart, onTypingStart)
    socket.on(SOCKET_EVENTS.typingStop, onTypingStop)
    socket.on(SOCKET_EVENTS.presence, onPresence)

    return () => {
      socket.off(SOCKET_EVENTS.messageNew, onMessageNew)
      socket.off(SOCKET_EVENTS.messageEdited, onMessageEdited)
      socket.off(SOCKET_EVENTS.messageDeleted, onMessageDeleted)
      socket.off(SOCKET_EVENTS.messageRead, onMessageRead)
      socket.off(SOCKET_EVENTS.messagePinned, onMessagePinned)
      socket.off(SOCKET_EVENTS.messageUnpinned, onMessageUnpinned)
      socket.off(SOCKET_EVENTS.chatCreated, onChatCreated)
      socket.off(SOCKET_EVENTS.chatUpdated, onChatUpdated)
      socket.off(SOCKET_EVENTS.chatDeleted, onChatDeleted)
      socket.off(SOCKET_EVENTS.memberAdded, onMemberAdded)
      socket.off(SOCKET_EVENTS.memberLeft, onMemberLeft)
      socket.off(SOCKET_EVENTS.memberRemoved, onMemberRemoved)
      socket.off(SOCKET_EVENTS.memberBlocked, onMemberBlocked)
      socket.off(SOCKET_EVENTS.typingStart, onTypingStart)
      socket.off(SOCKET_EVENTS.typingStop, onTypingStop)
      socket.off(SOCKET_EVENTS.presence, onPresence)
    }
  }, [talkUserId])

  /**
   * The catch-up, on EVERY accepted handshake — the four steps of §4.4.
   *
   * Realtime delivery is best-effort with no replay buffer, and room membership
   * does not survive a reconnect: a new socket is in no rooms. Skipping step 2 is
   * the classic bug, where the socket reconnects, reports healthy, and never
   * delivers another message.
   */
  useEffect(() => {
    if (talkUserId == null) return
    return onSocketConnected((_payload, isReconnect) => {
      void runCatchUp(isReconnect)
    })
  }, [talkUserId])
}

/** Steps 1–4: re-read the list, re-join every room, replay, clear typing. */
async function runCatchUp(isReconnect: boolean): Promise<void> {
  // Typing indicators are ephemeral and ours are now stale — a sender who stopped
  // while we were away will never tell us.
  useChatStore.getState().clearTyping()

  const chats = await refreshList()

  // Join on EVERY accepted handshake, first connect included. The list read that
  // runs at mount usually finishes before the socket is up, and a join issued
  // while disconnected is a no-op — so relying on it would leave a socket that
  // reports healthy and delivers nothing.
  await joinAll(chats)

  // Only a reconnect has a gap to replay: realtime delivery has no buffer, so
  // anything emitted while we were away is gone from the socket for good.
  if (isReconnect) {
    const open = activeChatId()
    if (open != null) await catchUpMessages(open)
  }
}

/**
 * Re-read the chat list. This fixes unread counts, previews and ordering, and —
 * just as importantly — refreshes the socket grant on every row.
 *
 * Answers the ids it read, so the caller can re-join exactly those.
 */
async function refreshList(): Promise<Id[]> {
  try {
    const page = await chatApi.fetchChats({})
    useChatListStore.getState().setChats(page.items, page.total)
    void chatApi
      .fetchUnreadSummary()
      .then((total) => useChatListStore.getState().setTotalUnread(total))
      .catch(() => undefined)
    return page.items.map((chat) => chat.id)
  } catch (error) {
    logger.warn('catch-up list read failed', error)
    return []
  }
}

/** Re-read one chat's header after a membership change. */
async function refreshChat(chatId: Id): Promise<void> {
  try {
    useChatListStore.getState().upsertChat(await chatApi.fetchChat(chatId))
  } catch (error) {
    // A 404 here is normal: we may have just lost access, and the events that
    // say so are handled separately.
    logger.warn('chat header re-read failed', chatId, error)
  }
}

/** Drop a chat we have lost access to — row, cache and open state together. */
function forgetChat(chatId: Id) {
  useMessageCacheStore.getState().clearChat(chatId)
  useChatListStore.getState().removeChats([chatId])
  if (activeChatId() === chatId) useChatStore.getState().setActiveChat(null)
}

/** True when the edited/deleted message is the one the preview is showing. */
function isLastMessage(chatId: Id, messageId: Id): boolean {
  const rows = useMessageCacheStore.getState().byChat[String(chatId)] ?? []
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (rows[i].id > 0) return rows[i].id === messageId
  }
  return false
}

/**
 * Whether we draw this person anywhere — the presence filter.
 *
 * A direct chat's counterpart is displayed by definition. Anyone in a group we
 * hold is displayed too, since their name appears above their bubbles.
 */
function isDisplayed(talkUserId: Id): boolean {
  const { chats } = useChatListStore.getState()
  if (chats.some((chat) => chat.counterpartTalkUserId === talkUserId)) return true
  const { presence } = useChatStore.getState()
  return presence[String(talkUserId)] !== undefined
}
