/* eslint-disable */
/**
 * The Talk push service worker.
 *
 * A web push is delivered to a WORKER, not to a tab — which is the whole point:
 * it arrives when every tab is closed. This file is served as a static asset, so
 * it never sees Vite's env substitution and never imports from `src/`. Its
 * Firebase config is handed to it in the QUERY STRING by
 * `src/lib/firebase-messaging.ts`, so there is exactly one copy of those values
 * in the project and it lives in `.env`.
 *
 * What it decides:
 *
 *  - LOUD vs SILENT. Every Talk event is pushed; only some interrupt. A silent
 *    one (`notification.body` is null — an edit, a receipt, a membership change)
 *    is forwarded to any open tab and NOTHING is drawn. Branch on the body being
 *    present, never on a hardcoded list of event names.
 *  - Which tab gets it. The whole event rides in `data.payload`, byte-identical
 *    to what the socket publishes, so an open-but-hidden tab applies it through
 *    the same handlers it already has. A focused tab never reaches here at all:
 *    Firebase routes those to `onMessage` in the page instead.
 *  - Where a tap goes. `chat_id` is a record id, and this app never puts one in
 *    a path, so the worker opens `/chat` and hands the event to the page, which
 *    owns the encrypted `?data=` token.
 */

importScripts('https://www.gstatic.com/firebasejs/12.18.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/12.18.0/firebase-messaging-compat.js')

/** Mirrors `PUSH_CLIENT_MESSAGES` in `features/notifications/constants.ts`. */
const PUSH_EVENT_MESSAGE = 'talk-push-event'
const PUSH_CLICK_MESSAGE = 'talk-push-click'
const PUSH_CLAIM_CLICK_MESSAGE = 'talk-push-claim-click'

/** Where a tap lands. The conversation is chosen by the page, not by the URL. */
const APP_PATH = new URL('./', self.location).pathname
const CHAT_PATH = `${APP_PATH}chat`

function readConfig() {
  const raw = new URL(self.location.href).searchParams.get('config')
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && parsed.apiKey && parsed.projectId ? parsed : null
  } catch (error) {
    return null
  }
}

const firebaseConfig = readConfig()

/**
 * A tap that had to COLD-START the app has no page to hand the event to yet, so
 * it is held here until the new tab asks for it. Best effort by nature: a worker
 * may be killed between the tap and the page booting, and the app opens on its
 * last conversation instead, which is a fine place to land.
 */
let pendingClick = null

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

/** Hand an event to every tab we have, hidden ones included. */
async function broadcast(message) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  for (const client of clients) client.postMessage(message)
  return clients
}

self.addEventListener('message', (event) => {
  // A freshly opened tab asking for the tap that started it.
  if (event.data && event.data.type === PUSH_CLAIM_CLICK_MESSAGE) {
    const claimed = pendingClick
    pendingClick = null
    event.source?.postMessage({ type: PUSH_CLICK_MESSAGE, payload: claimed })
  }
})

if (firebaseConfig) {
  firebase.initializeApp(firebaseConfig)
  const messaging = firebase.messaging()

  messaging.onBackgroundMessage(async (payload) => {
    const data = payload.data || {}
    // Forward FIRST. A hidden tab holds the live stores, and applying the event
    // is worth doing whether or not a banner is drawn for it.
    await broadcast({ type: PUSH_EVENT_MESSAGE, data })

    const notification = payload.notification || {}
    // SILENT: the event exists to keep a backgrounded client correct, not to
    // buzz. `notification` absent, or present with a null body.
    if (!notification.body) return

    const chatId = data.chat_id ? String(data.chat_id) : 'talk'
    await self.registration.showNotification(notification.title || 'Talk', {
      body: notification.body,
      // Only what the server sent — this app ships no favicon, and a made-up
      // path here would draw a broken image in the banner.
      icon: notification.icon || undefined,
      // One conversation collapses into one banner rather than stacking a
      // notification per message; `renotify` still alerts on the newer one.
      tag: `talk-chat-${chatId}`,
      renotify: true,
      data: { talkData: data },
    })
  })
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = (event.notification.data && event.notification.data.talkData) || null

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      const open = clients.find((client) => client.url.includes(APP_PATH))
      if (open) {
        await open.focus()
        open.postMessage({ type: PUSH_CLICK_MESSAGE, payload: data })
        return
      }
      // Cold start: nothing to hand it to yet, so it waits to be claimed.
      pendingClick = data
      await self.clients.openWindow(CHAT_PATH)
    })(),
  )
})
