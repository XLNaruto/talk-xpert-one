/**
 * Push notification constants.
 *
 * The message names are the contract between `public/firebase-messaging-sw.js`
 * and the page. The worker is a static asset and cannot import from `src/`, so
 * the strings are duplicated there — change both, or the tap goes nowhere.
 */

/** What the service worker posts to a tab, and what a tab asks it for. */
export const PUSH_CLIENT_MESSAGES = {
  /** A background push, forwarded so an open-but-hidden tab stays correct. */
  event: 'talk-push-event',
  /** A tapped banner, so the page can open the conversation it named. */
  click: 'talk-push-click',
  /** A freshly cold-started tab asking for the tap that opened it. */
  claimClick: 'talk-push-claim-click',
} as const

/**
 * How long to wait after sign-in before asking the browser for a token.
 *
 * The launch already fires the chat list read, the socket handshake and the
 * identity confirmation; a service worker registration on top of them delays the
 * first paint of the thread for something nobody is waiting on.
 */
export const PUSH_REGISTER_DELAY_MS = 1500
