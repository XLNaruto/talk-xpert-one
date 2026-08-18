import { useEffect, useRef, type ReactNode } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { useHasRealtime } from '@/hooks/use-app-config'
import {
  onAccessTokenRotated,
  refreshAccessToken,
  startTokenRefreshScheduler,
} from '@/lib/auth-refresh'
import {
  connectSocket,
  disconnectSocket,
  onSocketUnauthorized,
  updateSocketToken,
} from '@/lib/socket-client'
import { logger } from '@/lib/logger'

/**
 * Owns the socket lifecycle and the token that keeps it alive.
 *
 * Event SUBSCRIPTIONS belong to the feature that cares
 * (`features/chat/hooks/use-message-stream.ts`), not here. What lives here is the
 * three things the connection itself needs:
 *
 *  1. connect while signed in, disconnect on sign-out;
 *  2. re-handshake whenever the access token rotates — the socket does not
 *     refresh its own token, and would otherwise die silently at the half-hour;
 *  3. refresh once and reconnect when a handshake is refused as unauthorized.
 *
 * The realtime origin comes from `GET /config`, so this re-runs once that read
 * lands — and stays put when the deployment reports no realtime service.
 */
export function SocketProvider({ children }: { children: ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const hasRealtime = useHasRealtime()
  /** Guards against a refused-handshake storm firing many refreshes. */
  const isRecovering = useRef(false)

  // Keep the access token fresh for as long as the session lasts. The reactive
  // 401 path covers REST on its own; the socket has no request to hang a retry
  // on, so it needs the token renewed ahead of expiry.
  useEffect(() => {
    if (!isAuthenticated) return
    return startTokenRefreshScheduler()
  }, [isAuthenticated])

  useEffect(() => {
    if (!isAuthenticated || !hasRealtime) return

    connectSocket()

    // A rotated token means the socket is holding a dead one. Re-handshake with
    // the new one rather than waiting for the connection to lapse.
    const stopWatchingRotation = onAccessTokenRotated(updateSocketToken)

    // A refused handshake is answered by refreshing; the reconnect then happens
    // through the rotation listener above, so it is not repeated here.
    const stopWatchingRefusals = onSocketUnauthorized(() => {
      if (isRecovering.current) return
      isRecovering.current = true
      refreshAccessToken()
        .catch(() => {
          logger.warn('socket refused and refresh failed, signing out')
          useAuthStore.getState().logout('session-lost')
        })
        .finally(() => {
          isRecovering.current = false
        })
    })

    return () => {
      stopWatchingRotation()
      stopWatchingRefusals()
      disconnectSocket()
    }
  }, [isAuthenticated, hasRealtime])

  return <>{children}</>
}
