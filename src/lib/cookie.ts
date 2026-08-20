import { env } from '@/config/env'

/**
 * Cookie access, namespaced per app via `VITE_APP_COOKIE_PREFIX`.
 *
 * The prefix is what stops One Talk and the XpertOne admin app from
 * overwriting each other's session when they share an origin. Never touch
 * `document.cookie` outside this file.
 */
function key(name: string): string {
  return `${env.VITE_APP_COOKIE_PREFIX}-${name}`
}

export interface CookieOptions {
  path?: string
  expires?: Date
  sameSite?: 'strict' | 'lax' | 'none'
  secure?: boolean
}

export function getCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined
  const escaped = key(name).replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1')
  const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : undefined
}

export function setCookie(name: string, value: string, options: CookieOptions = {}) {
  const {
    path = '/',
    expires,
    sameSite = 'lax',
    secure = location.protocol === 'https:',
  } = options
  let cookie = `${key(name)}=${encodeURIComponent(value)}; path=${path}; samesite=${sameSite}`
  if (expires) cookie += `; expires=${expires.toUTCString()}`
  if (secure) cookie += '; secure'
  document.cookie = cookie
}

export function removeCookie(name: string, path = '/') {
  document.cookie = `${key(name)}=; path=${path}; expires=Thu, 01 Jan 1970 00:00:00 GMT`
}

/** Wipe every cookie in this app's namespace (sign-out). */
export function clearCookies() {
  const prefix = `${env.VITE_APP_COOKIE_PREFIX}-`
  for (const part of document.cookie.split(';')) {
    const name = part.split('=')[0]?.trim()
    if (name && name.startsWith(prefix)) {
      document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`
    }
  }
}
