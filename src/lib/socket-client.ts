import { io, type Socket } from 'socket.io-client'
import { socketUrl } from '@/config/env'
import { useAuthStore } from '@/stores/auth-store'
import { getAppConfig } from '@/stores/config-store'
import { resolveRealtimeTarget, type RealtimeTarget } from './config-mappers'
import { logger } from './logger'
import type { Id } from '@/types/api'

/**
 * The realtime transport, kept as a module-level singleton.
 *
 * ONE socket for the whole app. The gateway joins each connection to
 * `account:<id>` and `talk:<talkUserId>` — events are addressed to the PERSON,
 * not to a screen — so a second socket on the same token lands in the same rooms
 * and duplicates every event. The sidebar and the thread share this one and
 * demultiplex on `chat_id`.
 *
 * This is the service boundary: nothing outside this file imports socket.io.
 */
let socket: Socket | null = null

/**
 * Every chat room we want to be in.
 *
 * Room membership does NOT survive a reconnect — a new socket is in no rooms —
 * so this set is what gets re-joined on every `connected`. Losing it would be
 * the classic bug: the socket reconnects, reports healthy, and never delivers
 * another message.
 */
const wantedRooms = new Set<Id>()

/** Fired on every accepted handshake, including reconnects, for the catch-up. */
type ConnectedHandler = (payload: ConnectedPayload, isReconnect: boolean) => void

/** `connected` — the handshake ACK. `subject_id` is your own `talk_user_id`. */
export interface ConnectedPayload {
  scope?: string
  subject_id?: Id
  account_id?: Id
}

const connectedHandlers = new Set<ConnectedHandler>()
const unauthorizedHandlers = new Set<() => void>()

/**
 * Subscribe to accepted handshakes. The catch-up in §4.4 hangs off this: re-read
 * the chat list, re-join every room, replay the open thread with `after_id`,
 * and clear stale typing indicators.
 */
export function onSocketConnected(handler: ConnectedHandler): () => void {
  connectedHandlers.add(handler)
  return () => connectedHandlers.delete(handler)
}

/**
 * Subscribe to a refused handshake. The socket cannot refresh its own token, so
 * whoever owns the session (the socket provider) answers this by refreshing and
 * reconnecting.
 */
export function onSocketUnauthorized(handler: () => void): () => void {
  unauthorizedHandlers.add(handler)
  return () => unauthorizedHandlers.delete(handler)
}

/**
 * Where to dial, per `GET /config`. The server reports the origin instead of the
 * client compiling it in, because it differs per environment;
 * `VITE_APP_SOCKET_URL` is only the fallback for a launch where that read failed.
 */
function realtimeTarget(): RealtimeTarget | null {
  return resolveRealtimeTarget(getAppConfig(), socketUrl)
}

/** True when this deployment has a realtime service to connect to. */
export function hasRealtime(): boolean {
  return realtimeTarget() !== null
}

let hasConnectedOnce = false

/**
 * Open (or reuse) the connection. Returns null when there is no realtime
 * service configured — callers must handle that rather than assume a socket.
 */
export function connectSocket(): Socket | null {
  if (socket) return socket

  const target = realtimeTarget()
  if (!target) {
    logger.warn('no realtime service configured, skipping socket connect')
    return null
  }

  socket = io(target.url, {
    path: target.path,
    autoConnect: true,
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30_000,
    // The handshake carries the SAME access token the REST calls use. It must be
    // the access token — a refresh token is rejected.
    auth: { token: useAuthStore.getState().token },
  })

  socket.on('connect', () => logger.debug('socket transport up'))

  // `connect` only means the transport is up; `connected` is the gateway
  // accepting the token. The catch-up hangs off the latter.
  socket.on('connected', (payload: ConnectedPayload) => {
    const isReconnect = hasConnectedOnce
    hasConnectedOnce = true
    logger.debug(`socket ${isReconnect ? 're' : ''}connected`, payload)
    for (const handler of connectedHandlers) handler(payload ?? {}, isReconnect)
  })

  socket.on('disconnect', (reason: string) => {
    logger.debug('socket disconnected', reason)
  })

  socket.on('connect_error', (err: Error) => {
    logger.warn('socket handshake refused', err.message)
    if (/unauthor/i.test(err.message)) {
      for (const handler of unauthorizedHandlers) handler()
    }
  })

  return socket
}

export function getSocket(): Socket | null {
  return socket
}

/**
 * Whether a join would actually reach the gateway. A join emitted while the
 * transport is down is silently dropped, so callers check this rather than
 * treating the no-op as a refused grant.
 */
export function isSocketConnected(): boolean {
  return socket?.connected ?? false
}

/**
 * Re-handshake with a rotated access token.
 *
 * Called after every refresh. Without it the socket keeps whatever 30-minute
 * token it opened with and dies silently at the half-hour, with no request in
 * flight to hang a retry on.
 */
export function updateSocketToken(token: string) {
  if (!socket) return
  socket.auth = { token }
  socket.disconnect().connect()
}

export function disconnectSocket() {
  wantedRooms.clear()
  hasConnectedOnce = false
  if (socket) {
    socket.removeAllListeners()
    socket.disconnect()
  }
  socket = null
}

/**
 * Join a chat's room, so its `talk.message.*`, `talk.member.*` and
 * `talk.typing.*` events reach us.
 *
 * Connecting is not enough. The gateway holds no database and cannot work out
 * who is in chat 41, so the API records a short-lived grant during any read that
 * already proves membership and this is a key lookup against it.
 *
 * **Fetch first, then join** — a join with no preceding read is refused. Resolves
 * false on `not permitted`, which means the grant lapsed: re-read the chat (that
 * re-issues it) and retry once.
 */
export function joinChatRoom(chatId: Id): Promise<boolean> {
  wantedRooms.add(chatId)
  const active = socket
  if (!active?.connected) return Promise.resolve(false)

  return new Promise((resolve) => {
    active.emit('talk:join', { chat_id: chatId }, (res: { ok?: boolean } | undefined) => {
      const ok = Boolean(res?.ok)
      if (!ok) logger.warn('talk:join refused', chatId, res)
      resolve(ok)
    })
  })
}

/**
 * Leave a room. No ack, never fails.
 *
 * Worth doing only when the chat's SIDEBAR updates are also unwanted — the same
 * room feeds the list preview and the unread badge, so most clients only leave
 * on logout.
 */
export function leaveChatRoom(chatId: Id) {
  wantedRooms.delete(chatId)
  socket?.emit('talk:leave', { chat_id: chatId })
}

/**
 * Re-join everything after a reconnect. Step 2 of the catch-up, and the step
 * whose absence looks exactly like a healthy socket that delivers nothing.
 */
export async function rejoinChatRooms(): Promise<void> {
  const rooms = [...wantedRooms]
  await Promise.all(rooms.map((chatId) => joinChatRoom(chatId)))
}

/** The rooms we believe we should be in — read by the catch-up and by tests. */
export function joinedChatRooms(): Id[] {
  return [...wantedRooms]
}

/**
 * Signal typing over the socket, not HTTP.
 *
 * It is relayed socket-to-socket and never reaches the database, which is the
 * point: a composer fires this every few seconds. The room must already be
 * joined — a signal for a room we are not in is dropped. The sender is excluded
 * server-side, so we never see our own indicator.
 */
export function emitTyping(chatId: Id, typing: boolean) {
  socket?.emit('talk:typing', { chat_id: chatId, typing })
}
