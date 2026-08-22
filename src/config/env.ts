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

  /**
   * Firebase Cloud Messaging — the push transport. ALL SEVEN are blank by
   * default and push stays switched off until every one of them is filled in;
   * see `isPushConfigured` below. Nothing else in the app depends on them, so a
   * deployment with no Firebase project runs exactly as it did before.
   *
   * They are the web app's config from the Firebase console, plus the Web Push
   * certificate ("VAPID key") that `getToken` is called with. The values are
   * PUBLIC by design — a registration token is worthless without the service
   * account that sends to it, which lives on the server and never ships here.
   */
  VITE_APP_FIREBASE_API_KEY: z.string().default(''),
  VITE_APP_FIREBASE_AUTH_DOMAIN: z.string().default(''),
  VITE_APP_FIREBASE_PROJECT_ID: z.string().default(''),
  VITE_APP_FIREBASE_STORAGE_BUCKET: z.string().default(''),
  VITE_APP_FIREBASE_MESSAGING_SENDER_ID: z.string().default(''),
  VITE_APP_FIREBASE_APP_ID: z.string().default(''),
  /** Web Push certificate key pair — passed to `getToken({ vapidKey })`. */
  VITE_APP_FIREBASE_VAPID_KEY: z.string().default(''),
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

/**
 * Where the app is served from — Vite's own `base`, always leading- and
 * trailing-slashed. The service worker is registered against it, since a worker
 * may only control the scope it is served from.
 */
export const appBasePath = import.meta.env.BASE_URL || '/'

/**
 * The Firebase web app config, shaped as the SDK (and the service worker) take
 * it. Read it through `isPushConfigured()` first — every field can be blank.
 */
export const firebaseConfig = {
  apiKey: env.VITE_APP_FIREBASE_API_KEY,
  authDomain: env.VITE_APP_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_APP_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_APP_FIREBASE_APP_ID,
}

/** The Web Push certificate `getToken` is called with. Blank until configured. */
export const firebaseVapidKey = env.VITE_APP_FIREBASE_VAPID_KEY

/**
 * Whether this build can ask for a push token at all.
 *
 * Deliberately ALL-OR-NOTHING. A half-filled config fails deep inside the SDK
 * with a message about an invalid sender id, which reads like a bug in the app
 * rather than a blank in `.env` — so the whole subsystem stays dormant until
 * every value is present, and `use-push-notifications.ts` says so out loud once.
 */
export function isPushConfigured(): boolean {
  return (
    Object.values(firebaseConfig).every((value) => value.length > 0) &&
    firebaseVapidKey.length > 0
  )
}
