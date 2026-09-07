import { useCallback, useEffect, useState } from 'react'
import { toApiError } from '@/lib/api-error'
import { toastSuccess } from '@/lib/api-toast'
import { clearSessionState } from '@/lib/session'
import { disconnectSocket } from '@/lib/socket-client'
import { logger } from '@/lib/logger'
import type { TalkPlatform } from '@/lib/platform'
import { useAuthStore } from '@/stores/auth-store'
import * as authApi from './auth-api'
import type { LoginValues } from '../types'

/**
 * Mutation hooks. Talk has no server-state library, so these own their own
 * pending/error flags.
 */

/** What the form should show when a sign-in fails. */
export interface LoginFailure {
  message: string
  /** A suspended credential — a login form is useless, so don't offer a retry. */
  isSuspended: boolean
}

export function useLogin() {
  const setSession = useAuthStore((s) => s.setSession)
  const [isPending, setPending] = useState(false)
  const [failure, setFailure] = useState<LoginFailure | null>(null)

  const mutate = useCallback(
    async (values: LoginValues): Promise<boolean> => {
      setPending(true)
      setFailure(null)
      try {
        const session = await authApi.login(values)
        setSession(
          session.identity,
          session.accessToken,
          session.refreshToken,
          session.expiresIn,
        )
        toastSuccess('Signed in')
        return true
      } catch (error) {
        const { status, message } = toApiError(error)
        // 401 covers a wrong password AND an unknown email — the server refuses
        // to distinguish them, and neither should this message.
        setFailure({
          isSuspended: status === 403,
          message:
            status === 401
              ? 'Invalid email or password'
              : status === 403
                ? 'Your Talk access is suspended. Ask your administrator to restore it.'
                : message,
        })
        return false
      } finally {
        setPending(false)
      }
    },
    [setSession],
  )

  return { mutate, isPending, failure }
}

export function useLogout() {
  const logoutLocal = useAuthStore((s) => s.logout)
  const [isPending, setPending] = useState(false)

  const mutate = useCallback(
    async (allDevices = false) => {
      setPending(true)
      // Disconnect FIRST. A socket left open on a token we are about to revoke is
      // refused at its next reconnect anyway, but closing it first avoids a
      // pointless reconnect storm while the request is in flight.
      disconnectSocket()
      try {
        await authApi.logout(allDevices)
      } catch (error) {
        // Logout is idempotent, and a failed one must not trap the user in the app.
        logger.warn('server logout failed, clearing locally', error)
      } finally {
        // The same teardown the involuntary sign-outs run — see
        // `lib/session.ts`. Here it runs AFTER the request, so the server was
        // asked to retire this platform's device registration with a live
        // session; a 401 during it has already torn everything down itself.
        clearSessionState()
        logoutLocal('user')
        setPending(false)
        toastSuccess(allDevices ? 'Signed out on every device' : 'Signed out')
      }
    },
    [logoutLocal],
  )

  return { mutate, isPending }
}

/**
 * Which OS slots currently hold a live session.
 *
 * Informational only: a failure here must not block the one thing the account
 * sheet exists for, which is signing out, so it resolves to an empty list and
 * says so rather than throwing.
 */
export function useActiveSessions() {
  const [platforms, setPlatforms] = useState<TalkPlatform[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    authApi
      .fetchSessions()
      .then((sessions) => {
        if (!cancelled) setPlatforms(sessions.platforms)
      })
      .catch((error) => {
        logger.warn('session list read failed', error)
        if (cancelled) return
        setPlatforms([])
        setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { platforms, isLoading: platforms === null, failed }
}

/**
 * Confirm the stored identity against the server.
 *
 * A restored session carries a `talk_user_id` from whenever it was written, and
 * every "is this mine?" comparison in the app depends on it, so it is re-read
 * once at launch rather than trusted indefinitely.
 */
export function useRefreshIdentity() {
  const setIdentity = useAuthStore((s) => s.setIdentity)
  const email = useAuthStore((s) => s.identity?.email)

  return useCallback(async () => {
    try {
      const identity = await authApi.fetchMe()
      // `/talk/me` reports the email, but keep the one we already hold if the
      // response omits it — losing it would blank the account menu.
      setIdentity({ ...identity, email: identity.email || email || '' })
    } catch (error) {
      logger.warn('could not confirm identity', error)
    }
  }, [setIdentity, email])
}
