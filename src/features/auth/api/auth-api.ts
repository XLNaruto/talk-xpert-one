import { apiClient } from '@/lib/api-client'
import { ENDPOINTS } from '@/lib/endpoints'
import { CLIENT_PLATFORM } from '@/lib/platform'
import type { ActiveSessions, AuthSession, LoginValues, TalkIdentity } from '../types'
import {
  toActiveSessions,
  toAuthSession,
  toTalkIdentity,
  type LoginResponseDto,
  type MeResponseDto,
  type SessionsResponseDto,
} from '../lib/auth-mappers'

/**
 * Raw request functions. The ONLY place axios is called for auth; components go
 * through `api/use-auth.ts`.
 */

/**
 * Sign in.
 *
 * `platform` is mandatory — Talk allows one live session per operating system and
 * there is no default, so an unlabelled client would fight every other
 * unlabelled client for one slot. See `lib/platform.ts`.
 */
export async function login(values: LoginValues): Promise<AuthSession> {
  const res = await apiClient.post<LoginResponseDto>(ENDPOINTS.auth.login, {
    email: values.email,
    password: values.password,
    platform: CLIENT_PLATFORM,
  })
  return toAuthSession(res.data, values.email)
}

export async function fetchMe(): Promise<TalkIdentity> {
  const res = await apiClient.get<MeResponseDto>(ENDPOINTS.auth.me)
  return toTalkIdentity(res.data)
}

export async function fetchSessions(): Promise<ActiveSessions> {
  const res = await apiClient.get<SessionsResponseDto>(ENDPOINTS.auth.sessions)
  return toActiveSessions(res.data)
}

/**
 * Sign out. `allDevices: false` ends only THIS platform's session — the phone
 * signs out and the desktop stays in. True clears every platform, for a lost
 * device.
 *
 * Idempotent: calling it with an already-dead token is not an error, so local
 * state is cleared regardless of what this answers.
 */
export async function logout(allDevices = false): Promise<void> {
  await apiClient.post(ENDPOINTS.auth.logout, { all_devices: allDevices })
}
