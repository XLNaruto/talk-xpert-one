/** UI-facing auth types. Raw server shapes stay in `lib/auth-mappers.ts`. */
import type { TalkPlatform } from '@/lib/platform'
import type { TalkIdentity } from '@/stores/auth-store'

export type { TalkIdentity }

/**
 * What a sign-in yields: the identity — which now carries your `name` and your
 * avatar `photo` key alongside the ids — and the two tokens.
 */
export interface AuthSession {
  identity: TalkIdentity
  accessToken: string
  refreshToken: string
  /** Access-token lifetime in seconds — 1800 today. */
  expiresIn?: number
}

export interface LoginValues {
  email: string
  password: string
}

/** `GET /talk/auth/sessions` — which OS slots currently hold a live session. */
export interface ActiveSessions {
  platforms: TalkPlatform[]
}
