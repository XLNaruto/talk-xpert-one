import { z } from 'zod'
import { API_PROXY_PREFIX } from './api-proxy'

/**
 * Shape of the Firebase web-app config carried in `VITE_APP_FIREBASE_CONFIG`.
 * The four the SDK cannot start without are required; the two Cloud Messaging
 * fills in are optional so a config copied from a console tab that omits them
 * still parses (and `isPushConfigured` is what refuses to use it).
 */
const firebaseConfigSchema = z.object({
  apiKey: z.string(),
  authDomain: z.string(),
  projectId: z.string(),
  storageBucket: z.string().default(''),
  messagingSenderId: z.string().default(''),
  appId: z.string(),
})

type FirebaseConfig = z.infer<typeof firebaseConfigSchema>

/** What an unconfigured build gets — every field blank, nothing thrown. */
const EMPTY_FIREBASE_CONFIG: FirebaseConfig = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: '',
}

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
   * Firebase Cloud Messaging — the push transport. The web app config from the
   * Firebase console travels as ONE JSON object, exactly as the console hands
   * it over, so a new deployment pastes a single value instead of splitting it
   * into six. Blank by default, and push stays switched off until it and the
   * VAPID key are both filled in; see `isPushConfigured` below. Nothing else in
   * the app depends on them, so a deployment with no Firebase project runs
   * exactly as it did before.
   *
   * The values are PUBLIC by design — a registration token is worthless without
   * the service account that sends to it, which lives on the server and never
   * ships here.
   */
  VITE_APP_FIREBASE_CONFIG: z
    .string()
    .default('')
    .transform((value, ctx) => {
      if (!value.trim()) return EMPTY_FIREBASE_CONFIG
      try {
        return firebaseConfigSchema.parse(JSON.parse(value))
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Invalid VITE_APP_FIREBASE_CONFIG JSON' })
        return z.NEVER
      }
    }),
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
export const firebaseConfig = env.VITE_APP_FIREBASE_CONFIG

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
