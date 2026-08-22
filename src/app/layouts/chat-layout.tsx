import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import {
  ChatSidebar,
  MediaLightbox,
  useActiveChatRoute,
  useMessageStream,
  usePushOpenChat,
  useUnreadTitle,
} from '@/features/chat'
import { PushPermissionPrompt, usePushNotifications } from '@/features/notifications'
import { useRefreshIdentity } from '@/features/auth'
import { useUiStore } from '@/stores/ui-store'
import { cn } from '@/lib/utils'

/**
 * The app shell: a persistent conversation list beside the open thread.
 *
 * The realtime stream is mounted HERE, once, for the whole signed-in app. The
 * socket is a singleton whose rooms are addressed to the person rather than to a
 * screen, so binding it in a page would double-handle every event as the thread
 * changed — and the sidebar needs the same events as the thread anyway.
 *
 * On mobile the sidebar becomes an overlay — one layout, no duplicated markup.
 */
export function ChatLayout() {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen)
  const refreshIdentity = useRefreshIdentity()

  useMessageStream()
  // Binds the open chat to the `?data=` token: restores it on a refresh, opens
  // the newest conversation when there is nothing to restore.
  useActiveChatRoute()
  // The tab title's "(12)" — unread MESSAGES, where the sidebar's filter pills
  // count conversations. Mounted here so it follows the signed-in app rather
  // than whichever thread is open.
  useUnreadTitle()
  // Push: register this browser's FCM token, and hand every delivered event to
  // the stream's own handlers. Mounted here for the same reason as the stream —
  // the service worker talks to the TAB, not to a screen, so a second mount
  // would apply every background push twice.
  const push = usePushNotifications()
  // A tapped banner opens its conversation. Chat-side, because it is the chat
  // list and the active-chat token that decide what "open" means.
  usePushOpenChat()

  // Confirm the restored `talk_user_id` once per launch: every "is this mine?"
  // comparison depends on it, and a stale one would misalign every bubble.
  useEffect(() => {
    void refreshIdentity()
  }, [refreshIdentity])

  return (
    <div className="relative flex h-full w-full overflow-hidden bg-sidebar">
      {/* Fixed width on md+ — wide enough that a chat row's name and timestamp
          never collide, narrow enough that the thread stays the widest thing on
          screen. Below md it is a full-width overlay over the thread. */}
      <div
        className={cn(
          'absolute inset-y-0 left-0 z-20 w-full transition-transform md:static md:z-auto md:w-80 md:shrink-0 md:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <ChatSidebar />
      </div>

      {/* Teams-style content pane: the thread is a card whose LEFT corners are
          rounded, so the sidebar colour shows through top-left and bottom-left.
          Rounding only on md+ — on mobile the thread is the whole screen. */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden md:rounded-l-3xl md:border md:border-border md:border-r-0 md:shadow-sm">
        <Outlet />
      </main>

      {/* Mounted once here, for the same reason as the stream: a thumbnail in the
          virtualised thread and one in the details sheet open the SAME viewer, and
          it has to outlive both. */}
      <MediaLightbox />

      {/* Shown only when the browser has never been asked. `denied` is final,
          and an unconfigured or unsupported build offers nothing. */}
      <PushPermissionPrompt status={push.status} onEnable={() => void push.enable()} />
    </div>
  )
}
