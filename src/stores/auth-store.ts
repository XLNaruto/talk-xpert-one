import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { createIdbSessionStorage } from '@/lib/idb-storage'
import type { TalkPlatform } from '@/lib/platform'
import type { Id } from '@/types/api'

/**
 * The signed-in Talk identity, exactly as `POST /talk/auth/login` reports it.
 *
 * The login and `GET /talk/me` both carry your `name` and `photo` now, taken
 * from the master record behind the Talk credential. Both are nullable, so the
 * email's local part remains the fallback — see `selfLabel` in
 * `features/chat/lib/talk-directory.ts`, which is still the only place that
 * decides how a person is written.
 */
export interface TalkIdentity {
  /**
   * WHO YOU ARE, for every "is this mine?" comparison in the app. Not a user id
   * and not an employee id — never mix them. It is not in the JWT to be read;
   * it comes from the login response (or `GET /talk/me`).
   */
  talkUserId: Id
  accountId: Id
  email: string
  platform: TalkPlatform
  /** Your display name. Null when the master record has none. */
  name: string | null
  /** Your avatar's storage KEY — read it through `useMediaUrl()`. */
  photo: string | null
}

/** Why the session ended, so the login screen can say something true. */
export type SignOutReason =
  | 'user'
  /** Refresh failed — the credential was deleted, or taken by the same OS. */
  | 'session-lost'
  /** A 403: the credential is suspended. A login form would be useless. */
  | 'suspended'

interface AuthState {
  identity: TalkIdentity | null
  /** 30-minute access token — the Bearer on every request AND the socket handshake. */
  token: string | null
  /** 30-day refresh token. Sent to `/talk/auth/refresh` and NOWHERE else. */
  refreshToken: string | null
  /** Absolute expiry (epoch ms) of the access token; drives proactive refresh. */
  accessTokenExpiresAt: number | null
  isAuthenticated: boolean
  /** Set on sign-out so `/login` can explain itself. Cleared on the next login. */
  signOutReason: SignOutReason | null

  setSession: (
    identity: TalkIdentity,
    token: string,
    refreshToken: string,
    expiresIn?: number,
  ) => void
  /**
   * Store a rotated pair. The refresh token that bought this one is already dead,
   * so persisting the new one is not optional — a crash here loses the session.
   */
  setTokens: (token: string, refreshToken?: string | null, expiresIn?: number) => void
  setIdentity: (identity: TalkIdentity) => void
  clearSignOutReason: () => void
  logout: (reason?: SignOutReason) => void
}

function expiryFrom(expiresIn?: number): number | null {
  return expiresIn && expiresIn > 0 ? Date.now() + expiresIn * 1000 : null
}

/**
 * Global auth session — client state, encrypted into IndexedDB.
 *
 * Talk keeps its own session, separate from XpertOne admin: different store
 * name, different cookie namespace, no SSO between the two.
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      identity: null,
      token: null,
      refreshToken: null,
      accessTokenExpiresAt: null,
      isAuthenticated: false,
      signOutReason: null,

      setSession: (identity, token, refreshToken, expiresIn) =>
        set({
          identity,
          token,
          refreshToken,
          accessTokenExpiresAt: expiryFrom(expiresIn),
          isAuthenticated: true,
          signOutReason: null,
        }),

      setTokens: (token, refreshToken, expiresIn) =>
        set((s) => ({
          token,
          refreshToken: refreshToken ?? s.refreshToken,
          accessTokenExpiresAt: expiryFrom(expiresIn),
        })),

      setIdentity: (identity) => set({ identity }),

      clearSignOutReason: () => set({ signOutReason: null }),

      logout: (reason = 'user') =>
        set({
          identity: null,
          token: null,
          refreshToken: null,
          accessTokenExpiresAt: null,
          isAuthenticated: false,
          signOutReason: reason,
        }),
    }),
    {
      name: 'xpertone-talk-auth',
      // Encrypted at rest; hydrated explicitly in main.tsx so the route guards
      // see the restored session on first paint instead of bouncing to /login.
      storage: createJSONStorage(createIdbSessionStorage),
      skipHydration: true,
    },
  ),
)

/** Read the signed-in id outside React (mappers, socket handlers). */
export function currentTalkUserId(): Id | null {
  return useAuthStore.getState().identity?.talkUserId ?? null
}
