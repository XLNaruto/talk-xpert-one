import { CLIENT_PLATFORM, TALK_PLATFORMS, type TalkPlatform } from '@/lib/platform'
import type { ActiveSessions, AuthSession, TalkIdentity } from '../types'

/** Raw `POST /talk/auth/login` payload — snake_case, as the API sends it. */
export interface LoginResponseDto {
  access_token: string
  refresh_token: string
  expires_in?: number
  token_type?: string
  talk_user_id: number
  account_id: number
  platform?: string
  /** Your display name. Null when the master record has none. */
  name?: string | null
  /** Your avatar storage KEY — prefix with `media_path` from `GET /config`. */
  photo?: string | null
}

/** Raw `GET /talk/me`. */
export interface MeResponseDto {
  talk_user_id: number
  account_id: number
  email: string
  platform?: string
  name?: string | null
  photo?: string | null
}

export interface SessionsResponseDto {
  platforms?: string[]
}

function toPlatform(value: unknown): TalkPlatform {
  return TALK_PLATFORMS.includes(value as TalkPlatform)
    ? (value as TalkPlatform)
    : CLIENT_PLATFORM
}

/**
 * Pure mapping, server shape to UI shape.
 *
 * `email` is taken from what was typed, because the login response does not echo
 * it back. `name` and `photo` DO come back now — both nullable, and `photo` is a
 * storage key rather than a URL — so the email is the fallback label, not the
 * only one.
 */
export function toAuthSession(dto: LoginResponseDto, email: string): AuthSession {
  return {
    identity: {
      talkUserId: dto.talk_user_id,
      accountId: dto.account_id,
      email,
      platform: toPlatform(dto.platform),
      name: dto.name ?? null,
      photo: dto.photo ?? null,
    },
    accessToken: dto.access_token,
    refreshToken: dto.refresh_token,
    expiresIn: dto.expires_in,
  }
}

export function toTalkIdentity(dto: MeResponseDto): TalkIdentity {
  return {
    talkUserId: dto.talk_user_id,
    accountId: dto.account_id,
    email: dto.email,
    platform: toPlatform(dto.platform),
    name: dto.name ?? null,
    photo: dto.photo ?? null,
  }
}

export function toActiveSessions(dto: SessionsResponseDto): ActiveSessions {
  return { platforms: (dto.platforms ?? []).map(toPlatform) }
}
