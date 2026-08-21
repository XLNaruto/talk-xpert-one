import { useEffect, useMemo, useRef } from 'react'
import { useChatListStore } from '@/stores/chat-list-store'
import { deriveUnreadSummary } from '../lib/unread-badges'

/**
 * The app badge: unread MESSAGES in the browser tab's title.
 *
 * Messages, not conversations — the sidebar's pills count chats, an OS-style
 * badge counts messages, and mixing the two makes the same app disagree with
 * itself. Both come off the same rows, so they cannot drift.
 *
 * The title is a side effect on a document the router does not own, so the
 * document's own title is captured once and restored on unmount — signing out
 * must not leave "(12)" over the login screen.
 */
export function useUnreadTitle() {
  const chats = useChatListStore((s) => s.chats)
  const totalUnread = useMemo(() => deriveUnreadSummary(chats).totalUnread, [chats])
  const baseTitle = useRef(document.title)

  useEffect(() => {
    const base = baseTitle.current
    document.title = totalUnread > 0 ? `(${totalUnread > 99 ? '99+' : totalUnread}) ${base}` : base
    return () => {
      document.title = base
    }
  }, [totalUnread])
}
