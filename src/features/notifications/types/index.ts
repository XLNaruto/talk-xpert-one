import type { Id } from '@/types/api'

/** A registered handset, as `GET`/`POST /talk/devices` answers it. */
export interface PushDevice {
  id: Id
  /** The OS slot it holds — one live device per platform, like the session. */
  platform: string
  deviceName: string | null
  appVersion: string | null
  lastUsedAt: string | null
  createdAt: string | null
}

/**
 * A Talk event as it arrives over PUSH: the same object the socket publishes,
 * recovered whole from `data.payload`.
 *
 * `type` is the event name and `chat_id` is on everything chat-scoped. The rest
 * is left untyped on purpose — this is handed straight to the chat stream's own
 * handlers, which already know the shape of every event they take.
 */
export interface TalkPushEvent {
  type: string
  chat_id?: number
  [key: string]: unknown
}

/** What the permission flow can currently do, for the UI that offers it. */
export type PushStatus =
  /** No Firebase config in this build — nothing to offer. */
  | 'unconfigured'
  /** No service worker / Notification API here (Safari < 16.4, private windows). */
  | 'unsupported'
  /** Never asked. This is the only status worth showing a prompt for. */
  | 'prompt'
  | 'granted'
  /** Final — the browser will not show the prompt again from script. */
  | 'denied'
