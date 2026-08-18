import axios, { type InternalAxiosRequestConfig } from 'axios'
import { apiBaseUrl } from '@/config/env'
import { useAuthStore } from '@/stores/auth-store'
import { refreshAccessToken } from './auth-refresh'
import { logger } from './logger'

type RetriableConfig = InternalAxiosRequestConfig & { _retry?: boolean }

/**
 * The one axios instance. Components never import this — they call a hook from
 * a feature's `api/` folder, which calls a function in `<thing>-api.ts`.
 */
export const apiClient = axios.create({
  baseURL: apiBaseUrl,
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  timeout: 20_000,
})

apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error?.config as RetriableConfig | undefined
    const status = error?.response?.status

    /**
     * A failure on a request made with no session is the caller's to explain —
     * a wrong password at `/talk/auth/login` is a 401, and forcing a sign-out
     * here would overwrite the login screen's own message with "you were signed
     * out on another device".
     */
    if (!useAuthStore.getState().isAuthenticated) return Promise.reject(error)

    /**
     * A 403 is terminal. The credential is suspended (or the group owner blocked
     * you from posting) — refreshing cannot help, and showing a login form on a
     * suspended account is a sign-out loop. Only the login route reads the
     * reason; a posting refusal is left to the caller to surface in the thread.
     */
    if (status === 403 && isSuspended(error)) {
      logger.warn('credential suspended')
      useAuthStore.getState().logout('suspended')
      return Promise.reject(error)
    }

    // A 401 buys exactly one refresh-and-replay. `refreshAccessToken` is
    // single-flight, so a burst of 401s costs one call to /talk/auth/refresh.
    const canRetry =
      status === 401 &&
      original != null &&
      !original._retry &&
      Boolean(useAuthStore.getState().refreshToken)

    if (canRetry && original) {
      original._retry = true
      try {
        const token = await refreshAccessToken()
        original.headers.Authorization = `Bearer ${token}`
        return apiClient(original)
      } catch {
        // Refresh itself failed: the credential was deleted, or someone signed
        // in on another device of the same OS and took this slot.
        useAuthStore.getState().logout('session-lost')
        return Promise.reject(error)
      }
    }

    if (status === 401) useAuthStore.getState().logout('session-lost')

    return Promise.reject(error)
  },
)

/**
 * A 403 means two different things and only one of them ends the session.
 *
 * A suspended credential fails EVERY request; a posting refusal ("you were
 * removed", "unblock this person") fails one write and must leave the session
 * alone. The reads can't be refused for posting reasons, so a 403 on anything
 * other than a write is the suspended case.
 */
function isSuspended(error: unknown): boolean {
  const method = (
    (error as { config?: { method?: string } })?.config?.method ?? 'get'
  ).toLowerCase()
  return method === 'get'
}
