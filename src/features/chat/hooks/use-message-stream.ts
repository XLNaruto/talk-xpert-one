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
import { toChat, toChatMessage, type ChatDto, type MessageDto } from '../lib/chat-mappers'
import { peopleInChat, peopleInMessage } from '../lib/talk-directory'
import { catchUpMessages } from '../api/use-messages'
import * as chatApi from '../api/chat-api'
import { joinAll } from '../api/use-chats'

/**
 * Whoever performed the action, as every `talk.*` event now reports them.
 * Present on the read receipt, the pin, the disband and every membership change.
 */
interface EventActor {
  by_talk_user_id?: number
  by_name?: string | null
  by_photo?: string | null
}

/** Whoever the action was ABOUT — the member, the typist, the presence row. */
interface EventSubject {
  talk_user_id: number
  name?: string | null
  photo?: string | null
}

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

    /**
     * Every event now names the people in it — `name`/`photo` for the subject,
     * `by_name`/`by_photo` for whoever acted. Feeding those into the directory
     * on the way past is what keeps the two nameless events (typing, presence)
     * printing a name for somebody whose first message we never read.
     */
    const rememberActor = (payload: EventActor) => {
      rememberPeople([
        payload.by_talk_user_id == null
          ? null
          : {
              talkUserId: payload.by_talk_user_id,
              name: payload.by_name ?? null,
              photo: payload.by_photo ?? null,
            },
      ])
    }

    const rememberSubject = (payload: EventSubject) => {
      rememberPeople([
        payload.talk_user_id == null
          ? null
          : {
              talkUserId: payload.talk_user_id,
              name: payload.name ?? null,
              photo: payload.photo ?? null,
            },
      ])
    }

    /* ---- messages ---- */

    const onMessageNew = (payload: { chat_id: number; message: MessageDto }) => {
      if (!payload?.message) return
      const message = toChatMessage(payload.message)
      const chatId = payload.chat_id ?? message.chatId
      const isMine = message.senderTalkUserId === selfId.current

      // The event carries `sender_name` and `sender_photo`, so a person we have
      // never seen before is named the moment they first speak.
      rememberPeople(peopleInMessage(message))

      // We receive an echo of our OWN sends, because our socket is in the room,
      // and it usually beats our own HTTP response. The cache merges by id and
      // lands an echo of a send still in flight ON its optimistic bubble, so
      // this never appends a duplicate — and a message sent on another device of
      // ours still appears here.
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
    } & EventActor) => {
      rememberActor(payload)
      // Somebody else read MY messages: this is what turns my ticks blue. My own
      // read of their messages tells me nothing, so it is ignored.
      if (payload.by_talk_user_id === selfId.current) return
      cache().applyRead(payload.chat_id, payload.message_ids ?? [])
    }

    /**
     * The pin bar cannot be patched from the event.
     *
     * Pins EXPIRE, and the expiry is filtered at READ time rather than swept, so
     * only `GET /talk/chats/:id/pins` knows what the bar should now show. The
     * event flips the flag on the bubble and asks the bar to re-read — unless the
     * pin was mine, in which case `use-message-thread` has already done it.
     */
    const applyPinEvent = (
      payload: { chat_id: number; message_id: number } & EventActor,
      pinned: boolean,
    ) => {
      rememberActor(payload)
      cache().applyPinned(payload.chat_id, payload.message_id, pinned, true)
      if (payload.by_talk_user_id === selfId.current) return
      ui().bumpPins(payload.chat_id)
    }

    const onMessagePinned = (payload: { chat_id: number; message_id: number } & EventActor) =>
      applyPinEvent(payload, true)

    const onMessageUnpinned = (payload: { chat_id: number; message_id: number } & EventActor) =>
      applyPinEvent(payload, false)

    /**
     * MY OWN private bookmark, from ANOTHER DEVICE of mine.
     *
     * Not a chat event: it is addressed to my subject alone, never to the room,
     * so no other participant sees it and it says nothing about the chat-wide
     * pin. There is no actor to compare — every one of these is mine — so the
     * pin list is always asked to re-read: the device that made the pin already
     * re-read as part of its own write, and this arrives at the others.
     */
    const applySelfPinEvent = (
      payload: { chat_id: number; message_id: number },
      pinned: boolean,
    ) => {
      cache().applyPinned(payload.chat_id, payload.message_id, pinned, false)
      ui().bumpPins(payload.chat_id)
    }

    const onMessageSelfPinned = (payload: {
      chat_id: number
      message_id: number
      expires_at?: string | null
    }) => applySelfPinEvent(payload, true)

    const onMessageSelfUnpinned = (payload: { chat_id: number; message_id: number }) =>
      applySelfPinEvent(payload, false)

    /* ---- chats and members ---- */

    const onChatCreated = (
      payload: {
        chat_id: number
        created_by_talk_user_id?: number
        created_by_name?: string | null
        created_by_photo?: string | null
        /** The whole row, built from OUR side. Null in a delete-in-the-same-breath race. */
        chat?: ChatDto | null
      },
    ) => {
      // Addressed to us personally, so it arrives with no join and before any
      // read of our own.
      rememberPeople([
        payload.created_by_talk_user_id == null
          ? null
          : {
              talkUserId: payload.created_by_talk_user_id,
              name: payload.created_by_name ?? null,
              photo: payload.created_by_photo ?? null,
            },
      ])

      // The row now rides along, byte-identical to what `GET /talk/chats/:id`
      // would answer and already from OUR side — `self.member_role`, and a
      // direct chat's `counterpart_*` naming the creator — so it is inserted
      // straight in and the read is saved. The join still needs a grant, which
      // this event is not, so `adoptChat` reads first when there is no row.
      const chat = payload.chat ? toChat(payload.chat) : null
      if (chat) {
        rememberPeople(peopleInChat(chat))
        useChatListStore.getState().upsertChat(chat)
        void joinAll([chat.id])
        return
      }
      void adoptChat(payload.chat_id)
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

    const onChatDeleted = (payload: { chat_id: number } & EventActor) => {
      // Announced just BEFORE the disband, while we are still subscribed. We
      // are evicted immediately after, so this is final.
      rememberActor(payload)
      forgetChat(payload.chat_id)
    }

    /**
     * Membership drives the group's member count in the header AND the member
     * sheet, and the server owns both the roles and the block flags — so each is
     * re-read rather than guessed at. The sheet's own list is in a hook's state,
     * so it is asked to re-read through a revision tick.
     *
     * Skipped when the change was MINE: `use-members` re-read as part of the
     * write, and a second request would say the same thing.
     */
    const membersChanged = (chatId: number, byTalkUserId: number | undefined) => {
      void refreshChat(chatId)
      if (byTalkUserId === selfId.current) return
      ui().bumpMembers(chatId)
    }

    const onMemberAdded = (
      payload: {
        chat_id: number
        talk_user_ids: number[]
        members?: Array<{ talk_user_id: number; name?: string | null; photo?: string | null }>
      } & EventActor,
    ) => {
      rememberActor(payload)
      // `members[]` names everyone who just joined, so the sheet can print them
      // even before its own re-read lands.
      rememberPeople(
        (payload.members ?? []).map((member) => ({
          talkUserId: member.talk_user_id,
          name: member.name ?? null,
          photo: member.photo ?? null,
        })),
      )
      membersChanged(payload.chat_id, payload.by_talk_user_id)
    }

    const onMemberLeft = (payload: { chat_id: number } & EventSubject) => {
      rememberSubject(payload)
      if (payload.talk_user_id === selfId.current) {
        list().setSelfLeft(payload.chat_id)
        return
      }
      // Nobody else acts for you when you leave, so the leaver IS the actor.
      membersChanged(payload.chat_id, payload.talk_user_id)
    }

    const onMemberRemoved = (payload: { chat_id: number } & EventSubject & EventActor) => {
      rememberSubject(payload)
      rememberActor(payload)
      // This arrives TWICE for the person being removed — once addressed to
      // them, once to the room — so who it is about is decided by the id, never
      // by which delivery came first.
      // We are told just BEFORE the removal takes effect — afterwards we would no
      // longer be in the fan-out and would never learn of it.
      if (payload.talk_user_id === selfId.current) {
        forgetChat(payload.chat_id)
        return
      }
      membersChanged(payload.chat_id, payload.by_talk_user_id)
    }

    const onMemberBlocked = (
      payload: { chat_id: number; blocked: boolean } & EventSubject & EventActor,
    ) => {
      rememberSubject(payload)
      rememberActor(payload)
      if (payload.talk_user_id === selfId.current) {
        // Disable the composer, keep the chat readable — that is the whole point
        // of the owner's block, as against a removal.
        list().setSelfBlocked(payload.chat_id, payload.blocked)
        return
      }
      membersChanged(payload.chat_id, payload.by_talk_user_id)
    }

    /* ---- typing and presence ---- */

    const onTypingStart = (payload: { chat_id: number } & EventSubject) => {
      // The relay now carries a name, so "Asha is typing…" no longer depends on
      // having read this person somewhere else first. It is still remembered
      // rather than used directly, because presence has no such luxury.
      rememberSubject(payload)
      // The expiry is set here rather than trusted from a later `stop`: a client
      // that crashes mid-sentence never sends one.
      ui().startTyping(payload.chat_id, payload.talk_user_id, Date.now() + TYPING_EXPIRY_MS)
    }

    const onTypingStop = (payload: { chat_id: number } & EventSubject) => {
      ui().stopTyping(payload.chat_id, payload.talk_user_id)
    }

    const onPresence = (payload: {
      talk_user_id: number
      name?: string | null
      photo?: string | null
      is_online: boolean
      at?: string
    }) => {
      // The one Talk event broadcast to the WHOLE account, because the gateway
      // holds no database and cannot work out who shares a chat with whom. So it
      // is filtered here — otherwise the store fills with colleagues we have
      // never messaged.
      if (!isDisplayed(payload.talk_user_id)) return
      // A heartbeat may arrive with nothing but the id, so the directory backs
      // it up: overwriting a row with nulls would blank the member sheet every
      // time somebody went offline.
      const known = knownPerson(payload.talk_user_id)
      rememberSubject(payload)
      ui().applyPresence([
        {
          talkUserId: payload.talk_user_id,
          name: payload.name ?? known?.name ?? null,
          photo: payload.photo ?? known?.photo ?? null,
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
    socket.on(SOCKET_EVENTS.messageSelfPinned, onMessageSelfPinned)
    socket.on(SOCKET_EVENTS.messageSelfUnpinned, onMessageSelfUnpinned)
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
      socket.off(SOCKET_EVENTS.messageSelfPinned, onMessageSelfPinned)
      socket.off(SOCKET_EVENTS.messageSelfUnpinned, onMessageSelfUnpinned)
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
    // A catch-up, not a query — it must not wipe out a search the user is
    // in the middle of typing.
    useChatListStore.getState().setChats(page.items, page.total, 'refresh')
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

/**
 * Take on a chat we have just been told about.
 *
 * The FALLBACK, for the race where `talk.chat.created` carried no `chat`: the
 * event needs no join — you cannot have joined a chat that did not exist — but
 * for the same reason no read has happened yet, so there is no grant and a join
 * would be refused. Reading the chat is what issues one, so the order here is
 * load-bearing: read, insert the row, then join.
 */
async function adoptChat(chatId: Id): Promise<void> {
  try {
    useChatListStore.getState().upsertChat(await chatApi.fetchChat(chatId))
  } catch (error) {
    logger.warn('could not read a newly created chat', chatId, error)
    return
  }
  await joinAll([chatId])
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
