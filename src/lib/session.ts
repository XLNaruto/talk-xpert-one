import { clearTalkEventDedupe } from '@/features/chat/lib/talk-event-dedupe'
import { useAuthStore, type SignOutReason } from '@/stores/auth-store'
import { useChatListStore } from '@/stores/chat-list-store'
import { useChatStore } from '@/stores/chat-store'
import { useMessageCacheStore } from '@/stores/message-cache-store'
import { useTalkDirectoryStore } from '@/stores/talk-directory-store'
import { clearCookies } from './cookie'
import { logger } from './logger'
import { disconnectSocket } from './socket-client'

/**
 * End the session and take the account's data with it.
 *
 * The ONE teardown, so the involuntary sign-outs agree with the deliberate one.
 * `useAuthStore.logout()` only blanks the tokens: called on its own it leaves
 * the socket connected, the cookies set, and the previous account's messages,
 * chat list and names sitting in the stores — which the next person to sign in
 * on this browser would see on their first paint, before any read answers.
 *
 * A 401 that survived its one refresh-and-replay is exactly that case: the
 * credential is gone, or somebody signed in on another device of this OS and
 * took the slot. It arrives on either transport — the axios interceptor or a
 * socket ack — and both end here.
 *
 * Idempotent: a burst of 401s from parallel requests tears down once, so the
 * sign-out reason the login screen reads is the FIRST one, not the last.
 */
export function endSession(reason: SignOutReason): void {
  if (!useAuthStore.getState().isAuthenticated) return
  logger.warn('session ended', reason)

  // Close FIRST: a socket left open on a dead token only reconnect-storms while
  // the rest of the teardown runs.
  disconnectSocket()
  clearSessionState()
  useAuthStore.getState().logout(reason)
}

/**
 * Everything an account left behind, minus the auth store itself.
 *
 * Split out so the deliberate sign-out can clear it AFTER `POST
 * /talk/auth/logout` has been given the chance to run with a live session.
 */
export function clearSessionState(): void {
  useMessageCacheStore.getState().clear()
  useChatListStore.getState().clear()
  useChatStore.getState().reset()
  // Names and avatars belong to the signed-in account; the next person to use
  // this browser must not see them.
  useTalkDirectoryStore.getState().clear()
  // The socket-vs-push de-duplication cache is keyed on event identity, not on
  // the account — the next person to sign in must not have their first events
  // swallowed as "already seen".
  clearTalkEventDedupe()
  clearCookies()
}
