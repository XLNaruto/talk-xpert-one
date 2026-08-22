import { useEffect } from 'react'
import { onPushClick, pushChatId } from '@/features/notifications'
import { logger } from '@/lib/logger'
import { useChatListStore, cachedChat } from '@/stores/chat-list-store'
import { useChatStore } from '@/stores/chat-store'
import { useUiStore } from '@/stores/ui-store'
import * as chatApi from '../api/chat-api'

/**
 * Open the conversation a tapped notification named.
 *
 * The id never goes in the URL — `use-active-chat-route.ts` owns the encrypted
 * `?data=` token, and writing the active chat is all it takes for the token to
 * follow. So this does one thing: make sure the row exists, then select it.
 *
 * A row that is missing is the ordinary case for a tap, not an error: the chat
 * may have been created while this tab was closed, and `talk.chat.created` is
 * only delivered to a socket that was up. Reading it is also what issues the
 * room grant, so the read has to happen before the thread can go live.
 *
 * Mounted ONCE, by `chat-layout.tsx`.
 */
export function usePushOpenChat() {
  useEffect(() => {
    return onPushClick((event) => {
      const chatId = pushChatId(event)
      // `talk.unread.updated` is the one event with no `chat_id` — an
      // account-wide roll-up, filed under no conversation. A tap on it just
      // brings the app forward.
      if (chatId === null) return

      void (async () => {
        if (!cachedChat(chatId)) {
          try {
            useChatListStore.getState().upsertChat(await chatApi.fetchChat(chatId))
          } catch (error) {
            // Removed from the group, or the chat is gone. The app is already
            // focused, which is most of what the tap asked for.
            logger.warn('could not open the chat a notification named', chatId, error)
            return
          }
        }
        useChatStore.getState().setActiveChat(chatId)
        // On mobile the list sits OVER the thread, so opening a conversation
        // behind it would look like nothing happened.
        useUiStore.getState().setSidebarOpen(false)
      })()
    })
  }, [])
}
