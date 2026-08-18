/**
 * The Talk session slot this client occupies.
 *
 * Talk allows one live session per operating system, and `platform` is mandatory
 * on login — there is no default. A browser is always `WEB`, whatever OS it runs
 * on: the native Mac and Windows apps hold the `MAC` / `WINDOWS` slots, so a
 * browser claiming `MAC` would retire a signed-in desktop app.
 *
 * Refresh does NOT take a platform — it is read from the token, so a refresh can
 * never move a session between slots.
 */
export const TALK_PLATFORMS = [
  'ANDROID',
  'IOS',
  'MAC',
  'WINDOWS',
  'LINUX',
  'WEB',
] as const

export type TalkPlatform = (typeof TALK_PLATFORMS)[number]

/** This client's slot. A constant, deliberately — see the note above. */
export const CLIENT_PLATFORM: TalkPlatform = 'WEB'
