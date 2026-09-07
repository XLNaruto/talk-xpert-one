import axios from 'axios'
import { apiBaseUrl } from '@/config/env'
import { useAuthStore } from '@/stores/auth-store'
import { ENDPOINTS } from './endpoints'
import { logger } from './logger'
import { endSession } from './session'

/** How often to check whether the 30-minute access token is close to expiry. */
export const REFRESH_CHECK_INTERVAL_MS = 60 * 1000

/** Renew this far ahead of expiry, so an in-flight request can't race it. */
export const REFRESH_SKEW_MS = 2 * 60 * 1000

/**
 * `POST /talk/auth/refresh` answers a whole new pair — the token you sent is
 * dead. `refresh_token` is typed optional only so a non-rotating response keeps
 * the current one instead of clearing it.
 */
interface RefreshResponseDto {
  access_token: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
}

/**
 * A bare client, deliberately: refreshing must not recurse through the 401
 * interceptor that calls it.
 */
const refreshClient = axios.create({
  baseURL: apiBaseUrl,
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
})

let inFlight: Promise<string> | null = null

/** Notified with the new access token so the socket can re-handshake (§4.2). */
const listeners = new Set<(token: string) => void>()

export function onAccessTokenRotated(listener: (token: string) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Exchange the refresh token for a fresh pair.
 *
 * SINGLE-FLIGHT, and that is the whole point. The refresh token rotates and each
 * one works exactly once, so five concurrent 401s each firing their own refresh
 * would replay a spent token four times and sign the user out for no reason.
 * Everyone shares this one promise and replays behind it.
 */
export function refreshAccessToken(): Promise<string> {
  if (inFlight) return inFlight

  const { refreshToken } = useAuthStore.getState()
  if (!refreshToken) return Promise.reject(new Error('No refresh token'))

  inFlight = refreshClient
    .post<RefreshResponseDto>(ENDPOINTS.auth.refresh, { refresh_token: refreshToken })
    .then((res) => {
      const { access_token, refresh_token: rotated, expires_in } = res.data
      // Persisted BEFORE anything replays: the old token is already spent, so
      // losing the new one here would lose the session outright.
      useAuthStore.getState().setTokens(access_token, rotated, expires_in)
      for (const listener of listeners) listener(access_token)
      return access_token
    })
    .finally(() => {
      inFlight = null
    })

  return inFlight
}

let timer: ReturnType<typeof setInterval> | null = null

/**
 * Keep the access token fresh while signed in.
 *
 * The reactive 401 path alone would be enough for REST, but not for the socket:
 * it holds whichever token it handshook with and dies silently at the half-hour,
 * with no request to hang a retry on. Renewing ahead of expiry keeps it alive.
 */
export function startTokenRefreshScheduler(): () => void {
  stopTokenRefreshScheduler()

  timer = setInterval(() => {
    const { token, refreshToken, accessTokenExpiresAt } = useAuthStore.getState()
    if (!token || !refreshToken || accessTokenExpiresAt == null) return
    if (Date.now() < accessTokenExpiresAt - REFRESH_SKEW_MS) return
    refreshAccessToken().catch(() => {
      logger.warn('scheduled refresh failed, signing out')
      endSession('session-lost')
    })
  }, REFRESH_CHECK_INTERVAL_MS)

  return stopTokenRefreshScheduler
}

export function stopTokenRefreshScheduler() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
