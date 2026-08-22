import type { FirebaseApp } from 'firebase/app'
import type { MessagePayload, Messaging } from 'firebase/messaging'
import { appBasePath, firebaseConfig, firebaseVapidKey, isPushConfigured } from '@/config/env'
import { logger } from './logger'

/**
 * The push transport, and the ONLY file in the app that imports Firebase —
 * exactly as socket.io is confined to `lib/socket-client.ts`.
 *
 * Everything here is a no-op when `isPushConfigured()` is false, which is the
 * state a build ships in until the Firebase values are filled into `.env`. The
 * feature above (`features/notifications`) asks once, is told "not configured",
 * and stops; nothing else in the app changes behaviour.
 *
 * Three things live here and nowhere else:
 *
 *  1. the service worker registration — a web push arrives at a worker, not at
 *     a tab, so there has to be one even when every tab is closed;
 *  2. `getToken`, which is what a registration token IS: this browser, this
 *     origin, this VAPID key. It rotates on its own, and the caller re-registers
 *     it with `POST /talk/devices` every time it does;
 * The SDK itself is loaded on DEMAND. It is a few hundred kilobytes and this
 * build may never have a Firebase project behind it, so nothing is imported
 * until something has actually asked for a token.
 *
 *  3. `onMessage`, the FOREGROUND delivery path. A push that arrives while a tab
 *     has focus is NOT shown by the worker — the SDK hands it here instead, so
 *     the banner would be a duplicate of a thread the user is looking at.
 */

/** The worker file, served from `public/`. Kept here so the name has one home. */
const SERVICE_WORKER_FILE = 'firebase-messaging-sw.js'

let app: FirebaseApp | null = null
let messaging: Messaging | null = null
let registration: ServiceWorkerRegistration | null = null
/** One `isSupported()` per page — it probes IndexedDB and is not free. */
let supported: Promise<boolean> | null = null

/**
 * Whether this browser can receive a web push AT ALL.
 *
 * Three separate refusals, and they are not the same thing: an unconfigured
 * build (blank env), a browser without a service worker or the Notification API
 * (Safari below 16.4, and any browser in a private window), and Firebase's own
 * support probe. All three answer false, and none of them is an error.
 */
export function isPushSupported(): Promise<boolean> {
  if (!isPushConfigured()) return Promise.resolve(false)
  if (typeof window === 'undefined') return Promise.resolve(false)
  if (!('serviceWorker' in navigator) || !('Notification' in window)) {
    return Promise.resolve(false)
  }
  supported ??= import('firebase/messaging')
    .then((sdk) => sdk.isSupported())
    .catch(() => false)
  return supported
}

/** The browser's current answer, without asking. `default` means never asked. */
export function pushPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  return Notification.permission
}

async function firebaseApp(): Promise<FirebaseApp> {
  const { initializeApp } = await import('firebase/app')
  app ??= initializeApp(firebaseConfig)
  return app
}

/**
 * Register the worker that receives pushes while no tab is looking.
 *
 * The config rides in the QUERY STRING rather than being written into the file:
 * the worker is a static asset under `public/`, so it never sees Vite's env
 * substitution, and a hand-maintained copy of the same six values is a second
 * place to forget to update. `?v=` is not needed — the browser re-fetches a
 * worker whose URL differs by a byte, which is exactly what a changed config is.
 */
async function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (registration) return registration
  const params = new URLSearchParams({ config: JSON.stringify(firebaseConfig) })
  try {
    registration = await navigator.serviceWorker.register(
      `${appBasePath}${SERVICE_WORKER_FILE}?${params.toString()}`,
      { scope: appBasePath },
    )
    // `getToken` subscribes through this registration, and a worker still in
    // `installing` cannot take a subscription.
    await navigator.serviceWorker.ready
    return registration
  } catch (error) {
    logger.warn('push service worker registration failed', error)
    registration = null
    return null
  }
}

async function ensureMessaging(): Promise<Messaging | null> {
  if (!(await isPushSupported())) return null
  const { getMessaging } = await import('firebase/messaging')
  messaging ??= getMessaging(await firebaseApp())
  return messaging
}

/**
 * Ask the browser for permission, if it has not already answered.
 *
 * `Notification.requestPermission()` must be reached from a user gesture in some
 * browsers, which is why the caller offers a button rather than firing this at
 * launch. A `denied` answer is FINAL — the prompt cannot be shown again from
 * script, so never loop on it.
 */
export async function requestPushPermission(): Promise<NotificationPermission> {
  if (!(await isPushSupported())) return 'denied'
  if (Notification.permission !== 'default') return Notification.permission
  try {
    return await Notification.requestPermission()
  } catch (error) {
    logger.warn('notification permission request failed', error)
    return 'denied'
  }
}

/**
 * This browser's FCM registration token, or null when there isn't one to have.
 *
 * Null is an ordinary answer — unconfigured build, unsupported browser,
 * permission not granted, or a token request the network refused. The caller
 * registers whatever it gets with `POST /talk/devices`; there is nothing to
 * register when it gets nothing.
 */
export async function requestPushToken(): Promise<string | null> {
  const instance = await ensureMessaging()
  if (!instance) return null
  if (Notification.permission !== 'granted') return null

  const serviceWorkerRegistration = await ensureServiceWorker()
  if (!serviceWorkerRegistration) return null

  try {
    const { getToken } = await import('firebase/messaging')
    const token = await getToken(instance, {
      vapidKey: firebaseVapidKey,
      serviceWorkerRegistration,
    })
    return token || null
  } catch (error) {
    logger.warn('push token request failed', error)
    return null
  }
}

/**
 * Drop this browser's token at Firebase.
 *
 * Only for clearing local state WITHOUT a `/talk/auth/logout` — the logout route
 * already drops the server-side registration for this platform slot. A dead
 * token needs no cleanup either: that verdict arrives at the SENDER, so the
 * server prunes it itself.
 */
export async function revokePushToken(): Promise<void> {
  if (!messaging) return
  try {
    const { deleteToken } = await import('firebase/messaging')
    await deleteToken(messaging)
  } catch (error) {
    logger.warn('push token revoke failed', error)
  }
}

/**
 * Foreground pushes. Returns its own unsubscribe, or a no-op when there is
 * nothing to listen to.
 */
export function onForegroundPush(handler: (payload: MessagePayload) => void): () => void {
  let stop: (() => void) | null = null
  let cancelled = false

  void ensureMessaging().then(async (instance) => {
    if (!instance || cancelled) return
    const { onMessage } = await import('firebase/messaging')
    if (cancelled) return
    stop = onMessage(instance, handler)
  })

  return () => {
    cancelled = true
    stop?.()
  }
}

export type { MessagePayload }
