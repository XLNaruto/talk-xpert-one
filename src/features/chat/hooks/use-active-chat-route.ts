import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { decryptId, encryptId } from '@/lib/crypto'
import { useChatListStore } from '@/stores/chat-list-store'
import { useChatStore } from '@/stores/chat-store'
import { CHAT_URL_PARAM } from '../constants'
import { parseRouteTarget, routeTargetText } from '../lib/route-target'

/**
 * Keeps the open conversation — or broadcast list — in the URL, so a refresh
 * reopens it. Which of the two the token names is `lib/route-target.ts`.
 *
 * The id is ENCRYPTED into a single `?data=` token rather than written into the
 * path — `/chat/42` would publish a record id into history, the referer header
 * and every screenshot. `encryptId`/`decryptId` round-trip cleanly through
 * `URLSearchParams`, which encodes the token's own escapes a second time and
 * undoes them on read.
 *
 * Three jobs, in order of precedence:
 *  1. a token in the URL wins — that is what a refresh or a pasted link means;
 *  2. failing that, the newest conversation opens, so `/chat` is never an empty
 *     pane when there is something to read;
 *  3. after that, the URL follows whatever the user opens.
 *
 * Mounted ONCE, by `chat-layout.tsx`. Two mounts would race to write the token.
 */
export function useActiveChatRoute() {
  const [searchParams, setSearchParams] = useSearchParams()
  const chats = useChatListStore((s) => s.chats)
  const isLoaded = useChatListStore((s) => s.isLoaded)
  const activeChatId = useChatStore((s) => s.activeChatId)
  const setActiveChat = useChatStore((s) => s.setActiveChat)
  const activeBroadcastId = useChatStore((s) => s.activeBroadcastId)
  const setActiveBroadcast = useChatStore((s) => s.setActiveBroadcast)

  /**
   * Restore runs exactly once per session. Without the latch, closing a chat
   * would look like "no active chat" and immediately reopen the first one.
   */
  const restored = useRef(false)

  useEffect(() => {
    if (restored.current) return
    const fromUrl = parseRouteTarget(decryptId(searchParams.get(CHAT_URL_PARAM)))

    // A broadcast list is not in the chat list, so there is nothing to wait
    // for — the pane reads the list itself, and closes on its own when the list
    // is gone (deleted, or another account's token).
    if (fromUrl?.kind === 'broadcast') {
      restored.current = true
      setActiveBroadcast(fromUrl.target)
      return
    }

    // The cached list paints before the network answers, so this fires as soon
    // as there is anything to match against — IndexedDB or the API, whichever
    // lands first.
    if (!isLoaded && chats.length === 0) return
    restored.current = true

    // Only open what the list actually holds: a token from another account, or
    // for a chat since left, must not strand the pane on a chat that cannot load.
    if (fromUrl?.kind === 'chat' && chats.some((c) => c.id === fromUrl.id)) {
      setActiveChat(fromUrl.id)
      return
    }

    // The list is already sorted pinned-first then newest-first, so [0] is the
    // conversation the user most likely wants.
    if (activeChatId === null && chats.length > 0) setActiveChat(chats[0].id)
  }, [chats, isLoaded, searchParams, activeChatId, setActiveChat, setActiveBroadcast])

  useEffect(() => {
    // Writing before the restore has run would overwrite the very token being
    // restored from.
    if (!restored.current) return

    const wanted = routeTargetText(activeChatId, activeBroadcastId)
    // The cipher is salted, so the same id encrypts differently every time —
    // comparing tokens would rewrite the URL forever. Compare the plaintext.
    if (decryptId(searchParams.get(CHAT_URL_PARAM)) === wanted) return

    const next = new URLSearchParams(searchParams)
    if (wanted === null) next.delete(CHAT_URL_PARAM)
    else next.set(CHAT_URL_PARAM, encryptId(wanted))

    // `replace`, so stepping back leaves the app rather than walking every
    // conversation the user glanced at.
    setSearchParams(next, { replace: true })
  }, [activeChatId, activeBroadcastId, searchParams, setSearchParams])
}
