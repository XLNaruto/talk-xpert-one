import { useEffect, useMemo, useRef } from 'react'
import { emitTyping, isSocketConnected } from '@/lib/socket-client'
import { useChatStore } from '@/stores/chat-store'
import { useTalkDirectoryStore } from '@/stores/talk-directory-store'
import { keyOf, type Id } from '@/types/api'
import { TYPING_EXPIRY_MS, TYPING_THROTTLE_MS } from '../constants'
import { resolveTalkUser } from '../lib/talk-directory'
import { sendTypingOverHttp } from '../api/chat-api'

/**
 * Who is typing in one chat.
 *
 * The store holds an expiry per person and this prunes on a tick, because hiding
 * the indicator is the CLIENT's job: `talk.typing.stop` is an optimisation, not a
 * guarantee — a client that crashes mid-sentence never sends one, and without the
 * timer its indicator would stay up for ever.
 *
 * The ticker only runs while somebody is actually typing, so an idle thread costs
 * nothing.
 */
export function useTypingUsers(chatId: Id | null): Id[] {
  const entries = useChatStore((s) => (chatId == null ? undefined : s.typing[keyOf(chatId)]))
  const pruneTyping = useChatStore((s) => s.pruneTyping)
  const hasEntries = Boolean(entries?.length)

  useEffect(() => {
    if (!hasEntries) return
    const timer = setInterval(() => pruneTyping(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [hasEntries, pruneTyping])

  return useMemo(() => {
    if (!entries?.length) return []
    const now = Date.now()
    return entries.filter((entry) => entry.expiresAt > now).map((entry) => entry.talkUserId)
  }, [entries])
}

/**
 * The same people, named.
 *
 * `talk.typing.start` carries `{ chat_id, talk_user_id }` and nothing else —
 * it is one of only two events with no name attached — so the label comes from
 * the directory cache, which every REST read has been filling. Somebody nobody
 * has named yet still reads as `Member 42` rather than as a blank.
 */
export function useTypingNames(chatId: Id | null): string[] {
  const talkUserIds = useTypingUsers(chatId)
  const people = useTalkDirectoryStore((s) => s.people)
  const idsKey = talkUserIds.join(',')

  return useMemo(
    () =>
      (idsKey ? idsKey.split(',').map(Number) : []).map(
        (id) => resolveTalkUser(id, people[keyOf(id)]?.name).name,
      ),
    [idsKey, people],
  )
}

/**
 * Broadcast MY typing, throttled.
 *
 * `typing: true` goes out at most once every few seconds while the composer is
 * active — NEVER per keystroke, since nothing rate-limits this server-side yet.
 * A trailing `false` follows the last keystroke so the other side clears promptly
 * instead of waiting out its own expiry.
 */
export function useTypingBroadcast(chatId: Id | null) {
  const lastSentAt = useRef(0)
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isTyping = useRef(false)

  const clearStopTimer = () => {
    if (stopTimer.current) {
      clearTimeout(stopTimer.current)
      stopTimer.current = null
    }
  }

  /**
   * Prefer the socket: it is relayed socket-to-socket and never touches the
   * database. The HTTP route costs a round trip AND a membership query, so it is
   * used only when there is no live socket to emit on — a deployment with no
   * realtime service, or a moment mid-reconnect.
   */
  const signal = (id: Id, typing: boolean) => {
    if (isSocketConnected()) {
      emitTyping(id, typing)
      return
    }
    void sendTypingOverHttp(id, typing).catch(() => undefined)
  }

  /** Call on every keystroke. Cheap — it decides whether to emit at all. */
  const onActivity = () => {
    if (chatId == null) return
    const now = Date.now()
    if (!isTyping.current || now - lastSentAt.current >= TYPING_THROTTLE_MS) {
      signal(chatId, true)
      lastSentAt.current = now
      isTyping.current = true
    }
    clearStopTimer()
    stopTimer.current = setTimeout(() => stop(), TYPING_EXPIRY_MS)
  }

  /** Call on send, on blur, and on leaving the chat. */
  const stop = () => {
    clearStopTimer()
    if (chatId == null || !isTyping.current) return
    isTyping.current = false
    signal(chatId, false)
  }

  // Switching chats or unmounting must not leave a live indicator behind in the
  // chat we just left, so the stop is addressed to the id this effect captured.
  useEffect(() => {
    return () => {
      clearStopTimer()
      if (chatId != null && isTyping.current) {
        isTyping.current = false
        emitTyping(chatId, false)
      }
    }
  }, [chatId])

  return { onActivity, stop }
}
