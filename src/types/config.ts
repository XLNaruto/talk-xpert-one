/**
 * Client bootstrap configuration — what the app needs before it renders, read
 * once at launch and BEFORE signing in.
 *
 * These live on the server rather than in `config/env.ts` because the values
 * differ per environment and must be changeable without a client release.
 */
export interface AppConfig {
  /** Prefix for every stored file key the API returns. See `joinMediaPath`. */
  mediaPath: string
  /**
   * Origin of the realtime (Socket.IO) service. Empty string means this
   * deployment has no realtime service and the client should poll instead of
   * dialling a broken host.
   */
  realtimeUrl: string
  /** The Socket.IO path on that origin — `/socket.io` today. */
  realtimePath: string
}

export type ConfigStatus = 'idle' | 'loading' | 'ready' | 'error'
