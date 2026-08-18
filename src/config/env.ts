import { z } from 'zod'
import { API_PROXY_PREFIX } from './api-proxy'

/** All environment access flows through here (zod-parsed, fail-fast). */
const envSchema = z.object({
  VITE_APP_API_URL: z
    .string()
    .default('http://localhost:4000')
    .transform((v) => v || 'http://localhost:4000'),
  /** Dev-only reverse-proxy target; see `apiBaseUrl` below. */
  VITE_APP_API_TARGET: z.string().default(''),
  /**
   * socket.io origin — FALLBACK ONLY. The live origin and path come from
   * `GET /config`; this covers a launch where that read failed. Empty falls back
   * to `apiBaseUrl`.
   */
  VITE_APP_SOCKET_URL: z.string().default(''),
  /** Secret used to derive the key that encrypts persisted client storage. */
  VITE_APP_ENCRYPT_KEY: z.string().default('xpertone-talk-storage-key'),
  /**
   * Cookie / IndexedDB namespace. Must differ from the admin app's, or the two
   * sessions clobber each other when both are served from the same origin.
   */
  VITE_APP_COOKIE_PREFIX: z.string().default('xtk'),
})

const parsed = envSchema.safeParse(import.meta.env)

if (!parsed.success) {
  console.error(
    'Invalid environment variables:',
    z.flattenError(parsed.error).fieldErrors,
  )
  throw new Error('Invalid environment variables')
}

export const env = parsed.data

/**
 * Base URL every axios instance should use.
 *
 * With `VITE_APP_API_TARGET` set during `npm run dev` this is the same-origin
 * `/api` prefix the Vite dev server reverse-proxies to that target — no CORS
 * preflights. In a production build it's the real `VITE_APP_API_URL` origin.
 */
export const apiBaseUrl =
  import.meta.env.DEV && env.VITE_APP_API_TARGET
    ? API_PROXY_PREFIX
    : env.VITE_APP_API_URL

/**
 * Fallback socket.io origin, used only until/unless `GET /config` reports one.
 * Falls back further to the REST origin / dev proxy.
 */
export const socketUrl = env.VITE_APP_SOCKET_URL || apiBaseUrl
