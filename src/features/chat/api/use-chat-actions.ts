import { useCallback, useState } from 'react'
import { toastApiError, toastProblem, toastSuccess } from '@/lib/api-toast'
import { leaveChatRoom } from '@/lib/socket-client'
import { useChatListStore } from '@/stores/chat-list-store'
import { useChatStore } from '@/stores/chat-store'
import { useMessageCacheStore } from '@/stores/message-cache-store'
import type { Id } from '@/types/api'
import type { Chat, CreateGroupInput, UpdateChatInput } from '../types'
import * as chatApi from './chat-api'
import { canHideChat } from '../lib/chat-labels'
import { joinAll } from './use-chats'

/**
 * Take on a chat we just CREATED: subscribe and read it in one round trip.
 *
 * The creator earns the room grant at creation, so `talk:join` on the returned
 * id succeeds straight away with no read in front of it — and `with_chat` brings
 * the row back on the same ack. HTTP covers a deployment with no socket, a
 * refused join and a read that failed behind an accepted one.
 *
 * The creator never receives `talk.chat.created` for their own creation: this
 * row is the only one they get.
 */
async function adoptCreated(chatId: Id, upsertChat: (chat: Chat) => void): Promise<void> {
  const joined = await chatApi.joinAndReadChat(chatId)
  if (joined) {
    upsertChat(joined)
    return
  }
  upsertChat(await chatApi.fetchChat(chatId))
  await joinAll([chatId])
}

/**
 * Chat-level writes: opening, creating, pinning, renaming, leaving, disbanding,
 * hiding and blocking.
 *
 * Removing a chat has to do three things together — drop the row, drop its
 * cached messages, and leave its socket room — so those are done here rather than
 * left to three call sites to remember.
 */
export function useChatActions() {
  const upsertChat = useChatListStore((s) => s.upsertChat)
  const setPinnedLocal = useChatListStore((s) => s.setPinned)
  const removeChats = useChatListStore((s) => s.removeChats)
  const setSelfLeft = useChatListStore((s) => s.setSelfLeft)
  const applyMemberDelta = useChatListStore((s) => s.applyMemberDelta)
  const applyChatUpdated = useChatListStore((s) => s.applyChatUpdated)
  const clearChatCache = useMessageCacheStore((s) => s.clearChat)
  const setActiveChat = useChatStore((s) => s.setActiveChat)
  const setBlocked = useChatStore((s) => s.setBlocked)
  const [isPending, setPending] = useState(false)

  /** Forget a chat completely — row, cache and room, in one place. */
  const forget = useCallback(
    (chatIds: Id[]) => {
      for (const chatId of chatIds) {
        clearChatCache(chatId)
        leaveChatRoom(chatId)
      }
      removeChats(chatIds)
      if (chatIds.includes(useChatStore.getState().activeChatId ?? -1)) setActiveChat(null)
    },
    [clearChatCache, removeChats, setActiveChat],
  )

  /**
   * Idempotent: opening the same direct chat twice answers the same id.
   *
   * It also succeeds with somebody who has BLOCKED me — the thread is created
   * and I may send into it; they simply never see any of it. Only the other
   * direction is refused, and that refusal names itself.
   */
  const openDirect = useCallback(
    async (talkUserId: Id): Promise<Id | null> => {
      setPending(true)
      try {
        const { chatId } = await chatApi.openDirectChat(talkUserId)
        await adoptCreated(chatId, upsertChat)
        setActiveChat(chatId)
        return chatId
      } catch (error) {
        toastApiError(error, 'Could not open that conversation')
        return null
      } finally {
        setPending(false)
      }
    },
    [upsertChat, setActiveChat],
  )

  const createGroup = useCallback(
    async (input: CreateGroupInput): Promise<Id | null> => {
      setPending(true)
      try {
        const { chatId } = await chatApi.createGroup(input)
        await adoptCreated(chatId, upsertChat)
        setActiveChat(chatId)
        toastSuccess(`${input.name} is ready`)
        return chatId
      } catch (error) {
        toastApiError(error, 'That group was not created')
        return null
      } finally {
        setPending(false)
      }
    },
    [upsertChat, setActiveChat],
  )

  /** Rename / re-describe. Owner only, groups only. */
  const updateChat = useCallback(
    async (chatId: Id, input: UpdateChatInput): Promise<boolean> => {
      setPending(true)
      try {
        await chatApi.updateChat(chatId, input)
        applyChatUpdated(chatId, {
          name: input.name,
          description: input.description,
          avatarUrl: input.avatarUrl,
        })
        toastSuccess('Group details saved')
        return true
      } catch (error) {
        toastApiError(error, 'Those changes did not save')
        return false
      } finally {
        setPending(false)
      }
    },
    [applyChatUpdated],
  )

  /**
   * `notify` is off while creating a group — the create already said the group is
   * ready, and a second toast for its picture reads as two separate saves.
   */
  const uploadAvatar = useCallback(
    async (chatId: Id, file: File, notify = true): Promise<boolean> => {
      setPending(true)
      try {
        const key = await chatApi.uploadChatAvatar(chatId, file)
        applyChatUpdated(chatId, { avatarUrl: key })
        if (notify) toastSuccess('Group picture updated')
        return true
      } catch (error) {
        toastApiError(error, 'That picture was not saved')
        return false
      } finally {
        setPending(false)
      }
    },
    [applyChatUpdated],
  )

  /** Private to me — so the row re-sorts locally with no event to wait for. */
  const setChatPinned = useCallback(
    async (chatId: Id, pinned: boolean): Promise<boolean> => {
      setPinnedLocal(chatId, pinned)
      try {
        await chatApi.setChatPinned(chatId, pinned)
        return true
      } catch (error) {
        setPinnedLocal(chatId, !pinned)
        toastApiError(error, 'That pin did not save')
        return false
      }
    },
    [setPinnedLocal],
  )

  /**
   * Hide chats from my list. DIRECT chats only — the API refuses a group with a
   * 400, so groups are filtered out here rather than shown a failure.
   *
   * A hidden direct chat COMES BACK when a newer message arrives, with the old
   * messages still hidden. That is intended, which is why the cache is dropped.
   */
  const deleteForMe = useCallback(
    async (chatIds: Id[]): Promise<boolean> => {
      const chats = useChatListStore.getState().chats
      // Direct chats, and groups I have already left — the server's own rule.
      // A group I am still in is a 400 naming the ids, so it is dropped here
      // rather than taking the whole call down with it.
      const removableIds = chatIds.filter((id) => {
        const chat = chats.find((c) => c.id === id)
        return chat !== undefined && canHideChat(chat)
      })
      if (removableIds.length === 0) {
        toastProblem('Leave the group first — then you can remove it from your list.')
        return false
      }
      setPending(true)
      try {
        await chatApi.deleteChatsForMe(removableIds)
        forget(removableIds)
        toastSuccess(
          removableIds.length === 1
            ? 'Conversation removed'
            : `${removableIds.length} conversations removed`,
        )
        return true
      } catch (error) {
        toastApiError(error, 'Those conversations were not removed')
        return false
      } finally {
        setPending(false)
      }
    },
    [forget],
  )

  /** Anyone may leave. The owner cannot — they disband instead. */
  const leaveGroup = useCallback(
    async (chatId: Id): Promise<boolean> => {
      setPending(true)
      try {
        await chatApi.leaveChat(chatId)
        // The history stays readable, so the row survives with the composer off
        // rather than vanishing — leaving is not the same as deleting.
        setSelfLeft(chatId)
        // I am out of the count as of now. The echo of my own leave carries no
        // delta, so this is applied once and only here.
        applyMemberDelta(chatId, -1)
        leaveChatRoom(chatId)
        toastSuccess('You left the group')
        return true
      } catch (error) {
        toastApiError(error, 'You were not removed from that group')
        return false
      } finally {
        setPending(false)
      }
    },
    [setSelfLeft, applyMemberDelta],
  )

  /** Disband for everyone. Owner only, and irreversible for every member. */
  const disbandGroup = useCallback(
    async (chatId: Id): Promise<boolean> => {
      setPending(true)
      try {
        await chatApi.disbandChat(chatId)
        forget([chatId])
        toastSuccess('Group deleted for everyone')
        return true
      } catch (error) {
        toastApiError(error, 'That group was not deleted')
        return false
      } finally {
        setPending(false)
      }
    },
    [forget],
  )

  /**
   * My private, account-wide block for a direct chat. The other person is never
   * told, and it survives the chat being deleted.
   */
  const setPersonBlocked = useCallback(
    async (talkUserId: Id, blocked: boolean): Promise<boolean> => {
      setBlocked(talkUserId, blocked)
      try {
        await chatApi.setPersonBlocked(talkUserId, blocked)
        toastSuccess(blocked ? 'Blocked' : 'Unblocked')
        return true
      } catch (error) {
        setBlocked(talkUserId, !blocked)
        toastApiError(error, 'That change did not save')
        return false
      }
    },
    [setBlocked],
  )

  return {
    isPending,
    openDirect,
    createGroup,
    updateChat,
    uploadAvatar,
    setChatPinned,
    deleteForMe,
    leaveGroup,
    disbandGroup,
    setPersonBlocked,
    forget,
  }
}
