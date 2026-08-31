import { useEffect, useRef } from 'react'
import { connectSocket, leaveChatRoom, onSocketConnected } from '@/lib/socket-client'
import { isPageActive } from '@/hooks/use-page-active'
import { logger } from '@/lib/logger'
import { useAuthStore } from '@/stores/auth-store'
import { useChatListStore, cachedChat } from '@/stores/chat-list-store'
import { useChatStore, activeChatId } from '@/stores/chat-store'
import { hasPinnedMessages, useMessageCacheStore } from '@/stores/message-cache-store'
import { knownPerson, rememberPeople } from '@/stores/talk-directory-store'
import type { Id } from '@/types/api'
import { SOCKET_EVENTS, TYPING_EXPIRY_MS, ADOPT_RETRY_COOLDOWN_MS } from '../constants'
import {
  toChat,
  toChatMessage,
  toMemberRole,
  type ChatDto,
  type MessageDto,
  type MessageReceiptDto,
} from '../lib/chat-mappers'
import { peopleInChat, peopleInMessage } from '../lib/talk-directory'
import { systemActor } from '../lib/system-messages'
import { onPushEvent } from '@/features/notifications'
import { admitTalkEvent } from '../lib/talk-event-dedupe'
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

      // A message is READ when it lands in the reader's VIEWPORT. Three things
      // have to be true, and "the chat is open" is only the first of them: the
      // window must be the one being looked at, and the thread must be showing
      // its newest message rather than sitting up in history. Miss the last one
      // and a reader scrolled into last week has every arrival marked read
      // behind their back — blue ticks for the sender, no badge on the row, and
      // the thread's own count saying otherwise.
      const isWatched = activeChatId() === chatId && isPageActive()
      const landsInView = isWatched && ui().isThreadAtBottom
      // A system row has no sender, so the group corner and the preview would
      // have nobody to draw. `system_data` names who acted, and this is the only
      // moment that reaches the chat list — a list read carries no operands.
      const actor = message.type === 'system' ? systemActor(message) : null
      if (actor) rememberPeople([actor])

      list().applyIncoming(chatId, {
        preview: message.body,
        at: message.createdAt,
        senderTalkUserId: message.senderTalkUserId,
        senderName: message.senderName,
        senderPhoto: message.senderPhoto,
        actor,
        deletedForEveryone: false,
        // A message that has just arrived has been read by nobody, mine included.
        readByAll: false,
        // An edit arrives as `talk.message.edited`, never as a new message.
        edited: false,
        type: message.type,
        countsAsUnread: !isMine && !landsInView,
      })

      // A message for a chat we don't hold means we were just added and the list
      // is stale. Adopt that one chat — read it so the row exists, then JOIN it:
      // a re-read alone leaves us out of the room, so this would be the only
      // message from that group to arrive until the next reconnect.
      if (!cachedChat(chatId)) void adoptChat(chatId)

      // The receipt itself is NOT sent from here. `use-thread-scroll` owns read
      // state — it is the only thing that knows which rows the reader actually
      // has on screen — and it marks this message read as it follows it into
      // view, along with the row's badge. A second writer here is what put the
      // sidebar and the thread into disagreement.

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
      // The preview only changes when the edited message was the LAST one, which
      // the resync decides by looking at the cache the edit just landed in.
      resyncPreview(payload.chat_id)
    }

    const onMessageDeleted = (payload: { chat_id: number; message_ids: number[] }) => {
      const ids = payload.message_ids ?? []
      // Asked BEFORE the tombstone, which clears both pin flags on the row.
      const wasPinned = hasPinnedMessages(payload.chat_id, ids)
      // Delete for EVERYONE keeps the bubble as a tombstone — replies point at it.
      cache().applyDeleteForEveryone(payload.chat_id, ids)
      resyncPreview(payload.chat_id)
      // A deleted message cannot still be the chat's announcement, and my own
      // private bookmark on it goes too. Neither list can be patched from here —
      // pins expire and are filtered at read time — so both re-read.
      if (wasPinned) ui().bumpPins(payload.chat_id)
    }

    const onMessageRead = (payload: {
      chat_id: number
      message_ids: number[]
      by_talk_user_id: number
      /** One row per message read, same order and length as `message_ids`. */
      receipts?: MessageReceiptDto[]
    } & EventActor) => {
      rememberActor(payload)
      // Somebody else read MY messages: this is what turns my ticks blue. My own
      // read of their messages tells me nothing, so it is ignored.
      if (payload.by_talk_user_id === selfId.current) return

      // The receipts name the reader, and they are the READER'S OWN — nobody
      // else's read state is broadcast to a room. So in a GROUP one event means
      // "one more person", not "everybody": the double tick is earned only when
      // the readers add up to every member but me. A direct chat needs one.
      //
      // `readerTotal` is deliberately NULLABLE, and that is the fix for a group
      // that ticked through early: falling back to 1 when the chat row was not
      // cached — or when its `memberCount` had not arrived — gave a five-person
      // group direct-chat arithmetic, so the FIRST reader satisfied "everyone".
      // Not knowing the size means the question cannot be answered here; the
      // count still rises, and the server's own `is_read_by_all` settles it on
      // the next read of the thread.
      const chat = cachedChat(payload.chat_id)
      const readerTotal =
        chat === undefined
          ? null
          : chat.type === 'group'
            ? chat.memberCount > 1
              ? chat.memberCount - 1
              : null
            : 1

      const receipts = payload.receipts ?? []
      const ids = receipts.length > 0
        ? receipts.map((receipt) => receipt.message_id).filter((id): id is number => id != null)
        : (payload.message_ids ?? [])

      // A receipt names its own reader, so it is the better source than the
      // event's actor — they agree today, and if a batched event ever carries
      // somebody else's row the receipt is the one that is right.
      const readerTalkUserId = receipts[0]?.talk_user_id ?? payload.by_talk_user_id

      cache().applyRead(payload.chat_id, ids.length > 0 ? ids : (payload.message_ids ?? []), {
        readerTalkUserId,
        readerTotal,
      })
      // The sidebar carries the same tick as the bubble, and the cache is where
      // both read it from — so the row is rebuilt from the message that was just
      // marked read.
      resyncPreview(payload.chat_id)
      // An open message-info sheet is showing a list this read just changed.
      ui().bumpReceipts(payload.chat_id)
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
        /** The chat's KIND. The envelope's `type` is the event name — see #1. */
        chat_type?: string
        created_by_talk_user_id?: number
        created_by_name?: string | null
        created_by_photo?: string | null
        /**
         * Present when this is "you were ADDED to a group that already existed",
         * rather than "a chat was created with you in it". Either way the row
         * rides along and our sockets are already in the room, so the two are
         * handled identically — the adder is simply a second person to name.
         */
        added_by_talk_user_id?: number
        added_by_name?: string | null
        added_by_photo?: string | null
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
        payload.added_by_talk_user_id == null
          ? null
          : {
              talkUserId: payload.added_by_talk_user_id,
              name: payload.added_by_name ?? null,
              photo: payload.added_by_photo ?? null,
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
    const membersChanged = (
      chatId: number,
      byTalkUserId: number | undefined,
      delta = 0,
    ) => {
      void refreshChat(chatId)
      // The count is PATCHED only for somebody else's change. My own is already
      // on screen — `use-members` patched it as part of the write — and counting
      // it twice would show 5 → 7 → 6 until the re-read landed. The event may
      // also be the echo of MY OWN write, which would double it again.
      if (delta !== 0 && byTalkUserId !== selfId.current) {
        list().applyMemberDelta(chatId, delta)
      }
      // The sheet re-read is NOT skipped for my own actor: the actor may be me
      // on ANOTHER DEVICE, where no write ran and an open sheet would otherwise
      // sit stale. The re-read is authoritative and idempotent, so the worst case
      // on the acting device is one extra request.
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
      const added = payload.talk_user_ids ?? []

      // I am one of the people just added — so this is not a membership tweak to
      // a group I hold, it is a group ARRIVING.
      //
      // The server now tells the added people PERSONALLY, as a
      // `talk.chat.created` carrying the whole row and `added_by_talk_user_id`,
      // and admits their sockets to the room in the same call. That event
      // usually wins the race, so the row is already here and a read would only
      // re-fetch what we hold — the header is refreshed instead. `adoptChat`
      // stays as the fallback for the row not being here yet: without it a
      // group added by an older server sits in the sidebar dead until the next
      // reconnect. Either path also clears `self.hasLeft` when I am added back
      // to a group I had left.
      if (selfId.current != null && added.includes(selfId.current)) {
        if (cachedChat(payload.chat_id)) {
          void refreshChat(payload.chat_id)
          void joinAll([payload.chat_id])
        } else {
          void adoptChat(payload.chat_id)
        }
        ui().bumpMembers(payload.chat_id)
        return
      }

      membersChanged(payload.chat_id, payload.by_talk_user_id, added.length || 1)
    }

    const onMemberLeft = (payload: { chat_id: number } & EventSubject) => {
      rememberSubject(payload)
      if (payload.talk_user_id === selfId.current) {
        // Left from another device of mine: the history stays readable, so the
        // row survives with the composer off — but the room goes, since nothing
        // in that group concerns me any more.
        list().setSelfLeft(payload.chat_id)
        // The count is re-read rather than decremented: this may be the echo of
        // my own leave, which already applied its own -1.
        void refreshChat(payload.chat_id)
        ui().bumpMembers(payload.chat_id)
        leaveChatRoom(payload.chat_id)
        return
      }
      // Nobody else acts for you when you leave, so the leaver IS the actor.
      membersChanged(payload.chat_id, payload.talk_user_id, -1)
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
      membersChanged(payload.chat_id, payload.by_talk_user_id, -1)
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

    /**
     * Somebody's role moved: promoted to admin, demoted back to a member, or —
     * when `member_role` is `owner` — handed the group because its owner LEFT.
     * All three arrive as one event; `previous_member_role` is what tells them
     * apart without a lookup.
     *
     * When it names ME, `chat.self.member_role` is patched here and now: it is
     * the field every "can I manage this group" check reads, so a promoted
     * member would otherwise see no new controls and a demoted one would keep
     * stale ones until they reloaded.
     *
     * The system line arrives beside this as its own `talk.message.new`, so the
     * thread updates on its own and nothing is written to it from here.
     */
    const onMemberRoleChanged = (
      payload: {
        chat_id: number
        member_role?: string
        previous_member_role?: string
      } & EventSubject &
        EventActor,
    ) => {
      rememberSubject(payload)
      // On succession `by_*` is the person who LEFT, not a promoter — but they
      // are a person either way, and remembering them keeps the line readable.
      rememberActor(payload)
      const role = toMemberRole(payload.member_role)
      if (payload.talk_user_id === selfId.current) {
        list().setSelfRole(payload.chat_id, role)
      }
      // The sheet's list lives in a hook's state, so it is asked to re-read —
      // and the header is refreshed for the same reason `membersChanged` does
      // it: the chat row's own `self` is the server's to confirm.
      void refreshChat(payload.chat_id)
      ui().bumpMembers(payload.chat_id)
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

    /**
     * Every handler, by the event that feeds it — because the SOCKET is no
     * longer the only thing that feeds them.
     *
     * A push carries the same object the socket publishes (`data.payload` is
     * byte-identical), so a background push is applied by running the handler
     * that already exists rather than by a second set of handlers that would
     * drift from these. Both paths go through `admitTalkEvent` first: a
     * connected client receives every event twice, once each way.
     */
    const handlers: Record<string, (payload: never) => void> = {
      [SOCKET_EVENTS.messageNew]: onMessageNew,
      [SOCKET_EVENTS.messageEdited]: onMessageEdited,
      [SOCKET_EVENTS.messageDeleted]: onMessageDeleted,
      [SOCKET_EVENTS.messageRead]: onMessageRead,
      [SOCKET_EVENTS.messagePinned]: onMessagePinned,
      [SOCKET_EVENTS.messageUnpinned]: onMessageUnpinned,
      [SOCKET_EVENTS.messageSelfPinned]: onMessageSelfPinned,
      [SOCKET_EVENTS.messageSelfUnpinned]: onMessageSelfUnpinned,
      [SOCKET_EVENTS.chatCreated]: onChatCreated,
      [SOCKET_EVENTS.chatUpdated]: onChatUpdated,
      [SOCKET_EVENTS.chatDeleted]: onChatDeleted,
      [SOCKET_EVENTS.memberAdded]: onMemberAdded,
      [SOCKET_EVENTS.memberLeft]: onMemberLeft,
      [SOCKET_EVENTS.memberRemoved]: onMemberRemoved,
      [SOCKET_EVENTS.memberBlocked]: onMemberBlocked,
      [SOCKET_EVENTS.memberRoleChanged]: onMemberRoleChanged,
      [SOCKET_EVENTS.typingStart]: onTypingStart,
      [SOCKET_EVENTS.typingStop]: onTypingStop,
      [SOCKET_EVENTS.presence]: onPresence,
    }

    /** Run one event through its handler, if it is one we know and have not seen. */
    const dispatch = (type: string, payload: unknown) => {
      const handler = handlers[type]
      const admitted = Boolean(handler) && admitTalkEvent(type, payload)
      // The whole arrival, before anything is decided about it. Three different
      // failures look identical from the UI — the server never sent it, we are
      // not in the room, or the dedupe swallowed the copy that arrived second —
      // and this line is what tells them apart.
      logger.info('talk event', type, {
        known: Boolean(handler),
        admitted,
        chatId: (payload as { chat_id?: unknown } | null)?.chat_id ?? null,
      })
      if (!admitted) return
      ;(handler as (value: unknown) => void)(payload)
    }

    const socketBindings = Object.entries(handlers).map(([type]) => {
      const listener = (payload: unknown) => dispatch(type, payload)
      socket.on(type, listener)
      return [type, listener] as const
    })

    /**
     * The push path.
     *
     * A push reaches us three ways — a foreground `onMessage`, a background one
     * forwarded by the service worker, and a tapped banner — and all three
     * arrive here as the same object. Events the socket handles are applied;
     * anything else (`talk.unread.updated`, or something the server adds later)
     * is a NUDGE, and the honest response to a nudge is to re-read, because REST
     * is the source of truth and both delivery paths are best-effort.
     */
    const stopPushBridge = onPushEvent((event) => {
      const known = Boolean(handlers[event.type])
      logger.debug('push → handler', { type: event.type, known, chatId: event.chat_id ?? null })
      if (known) {
        dispatch(event.type, event)
        return
      }
      void refreshList()
    })

    return () => {
      for (const [type, listener] of socketBindings) socket.off(type, listener)
      stopPushBridge()
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
    return page.items.map((chat) => chat.id)
  } catch (error) {
    logger.warn('catch-up list read failed', error)
    return []
  }
}

/**
 * Take on a chat we have just been told about — read it, insert the row, join.
 *
 * Three callers: the race where `talk.chat.created` carried no `chat`, being
 * ADDED to a group that already existed (`talk.member.added` naming me), and a
 * message for a chat we do not hold. None of those events carries a grant, so a
 * bare join would be refused; reading the chat is what issues one, which makes
 * the order load-bearing: read, insert the row, then join.
 */
async function adoptChat(chatId: Id): Promise<void> {
  const key = String(chatId)
  // A burst arrives as a burst: ten messages in a chat we do not hold would
  // otherwise be ten identical reads, nine of them answering a question the
  // first one is already asking.
  if (adoptingChats.has(key)) return
  const refusedAt = unadoptableChats.get(key)
  if (refusedAt !== undefined && Date.now() - refusedAt < ADOPT_RETRY_COOLDOWN_MS) return

  adoptingChats.add(key)
  try {
    useChatListStore.getState().upsertChat(await chatApi.fetchChat(chatId))
    unadoptableChats.delete(key)
  } catch (error) {
    // A refusal is a real answer — the chat may be one we were removed from,
    // and every later message in it would ask again. Backed off rather than
    // retried per message.
    unadoptableChats.set(key, Date.now())
    logger.warn('could not read a chat we were told about', chatId, error)
    return
  } finally {
    adoptingChats.delete(key)
  }
  await joinAll([chatId])
  // No badge read to follow: the row's own `unread_count` came with the chat,
  // and the tab pills are derived from the rows — so inserting one is all the
  // badges need. A group we were just added to counts zero anyway, since its
  // history before the join is closed to us.
}

/** Reads in flight, and chats whose read was refused — see `adoptChat`. */
const adoptingChats = new Set<string>()
const unadoptableChats = new Map<string, number>()

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

/**
 * Drop a chat we have lost access to — row, cache, room and open state together.
 *
 * The room matters: `wantedRooms` is what the reconnect re-join walks, so a chat
 * left in it is re-joined on every handshake for the rest of the session and
 * refused every time.
 */
function forgetChat(chatId: Id) {
  useMessageCacheStore.getState().clearChat(chatId)
  useChatListStore.getState().removeChats([chatId])
  leaveChatRoom(chatId)
  if (activeChatId() === chatId) useChatStore.getState().setActiveChat(null)
}

/**
 * Rewrite a row's preview from the newest message the cache holds.
 *
 * A delete or an edit changes what the sidebar should say, and only the cache
 * knows what is left: a delete FOR EVERYONE leaves a tombstone, which the row
 * has to be TOLD about — a null preview alone means "Attachment" to
 * `previewLine` — and a delete FOR ME removes the row entirely, so the message
 * BEFORE it becomes the preview.
 *
 * The cache is authoritative here only because it is filled from the newest end:
 * the newest row it holds is the newest row there is. Anything newer on the row
 * than the cache knows about means the cache is behind, so the row is left alone.
 */
export function resyncPreview(chatId: Id): void {
  const chat = cachedChat(chatId)
  if (!chat) return
  const rows = useMessageCacheStore.getState().byChat[String(chatId)] ?? []
  // Skip optimistic rows: a pending send has a negative id and no server time.
  let newest: (typeof rows)[number] | undefined
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (rows[i].id > 0) {
      newest = rows[i]
      break
    }
  }
  if (!newest) return
  if (chat.lastMessageAt && newest.createdAt < chat.lastMessageAt) return

  const actor = newest.type === 'system' ? systemActor(newest) : null
  useChatListStore.getState().applyIncoming(chatId, {
    preview: newest.body,
    at: newest.createdAt,
    senderTalkUserId: newest.senderTalkUserId,
    senderName: newest.senderName,
    senderPhoto: newest.senderPhoto,
    actor,
    deletedForEveryone: newest.isDeletedForEveryone,
    readByAll: newest.isReadByAll,
    type: newest.type,
    edited: newest.isEdited,
    countsAsUnread: false,
  })
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
