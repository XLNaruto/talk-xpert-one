import { io, type Socket } from 'socket.io-client'
import { socketUrl } from '@/config/env'
import { useAuthStore } from '@/stores/auth-store'
import { getAppConfig } from '@/stores/config-store'
import { SocketAckError } from './api-error'
import { refreshAccessToken } from './auth-refresh'
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
 * Hand the socket a rotated access token.
 *
 * Called after EVERY refresh, and skipping it is the single most confusing
 * failure in this contract: the connection keeps whatever 30-minute token it
 * handshook with, still reports connected, and every write starts failing 401
 * about half an hour in with no request in flight to hang a retry on.
 *
 * Two things are updated and they do different jobs:
 *
 *  - `talk:auth.token` replaces the bearer on the LIVE socket, in place. No
 *    reconnect, so no lost rooms and no catch-up — which is why this is
 *    preferred over the disconnect/connect it replaced.
 *  - `socket.auth` fixes the NEXT handshake, so an automatic reconnect does not
 *    dial with the dead token.
 *
 * The gateway re-verifies the replacement with the handshake's own checks and
 * refuses a token naming a different person, so a failure here is answered by
 * reconnecting outright rather than by carrying on.
 */
export function updateSocketToken(token: string): Promise<void> {
  const active = socket
  if (!active) return Promise.resolve()

  // The next handshake, first — a reconnect may fire before the ack lands.
  active.auth = { token }
  if (!active.connected) {
    // Down already: nothing to replace in place, and this may be the recovery
    // from a handshake refused as unauthorized — so dial again with the new one.
    active.connect()
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    active
      .timeout(ACK_TIMEOUT_MS)
      .emit(
        'talk:auth.token',
        { token },
        (timeout: Error | null, res: { ok?: boolean } | undefined) => {
          if (!timeout && res?.ok) {
            logger.debug('socket bearer replaced in place')
            resolve()
            return
          }
          // Rooms are lost by this, so it is the fallback and not the path:
          // the reconnect re-handshakes with `socket.auth`, and the `connected`
          // catch-up re-reads and re-joins.
          logger.warn('talk:auth.token refused, reconnecting instead', timeout ?? res)
          active.disconnect().connect()
          resolve()
        },
      )
  })
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

/* ---------------------------------------------------------------- */
/* Writes over the socket — the ack contract                         */
/* ---------------------------------------------------------------- */

/**
 * How long to wait for an ack.
 *
 * The gateway gives the REST route it bridges to 15 s before answering `503`,
 * so anything past that is the socket itself being gone rather than the route
 * being slow.
 */
const ACK_TIMEOUT_MS = 20_000

/**
 * Every bridged inbound event answers this, and only this.
 *
 * `status` is the HTTP status the underlying route returned and `data` is its
 * response body byte-for-byte, so the same error handling works for both
 * transports — the gateway holds no database and is literally calling the route
 * one hop away with our own bearer token.
 */
export type TalkAck<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: { code?: string; message?: string; details?: unknown } }

/**
 * Whether a write should go over the socket at all.
 *
 * False on a deployment with no realtime service, and false mid-reconnect — in
 * both cases the caller falls back to HTTP, which is the same code path on the
 * server and therefore not a degraded one.
 */
export function canSendOverSocket(): boolean {
  return socket?.connected ?? false
}

/**
 * Emit a bridged event and resolve its response body.
 *
 * Rejects with a `SocketAckError` carrying the route's own status and error
 * envelope, so a screen above this cannot tell whether HTTP or the socket ran.
 *
 * A `401` means the access token expired underneath a socket that still looks
 * healthy: refresh once, push the new bearer in place, replay once. A second
 * `401` is a real one and is thrown.
 */
export async function socketCall<T>(
  event: string,
  payload: Record<string, unknown>,
  retried = false,
): Promise<T> {
  const active = socket
  if (!active?.connected) throw new SocketAckError(0, { code: 'OFFLINE', message: 'No connection' })

  const ack = await new Promise<TalkAck<T>>((resolve, reject) => {
    active
      .timeout(ACK_TIMEOUT_MS)
      .emit(event, payload, (timeout: Error | null, res: TalkAck<T> | undefined) => {
        if (timeout || !res) {
          reject(
            new SocketAckError(0, {
              code: 'TIMEOUT',
              message: 'The server did not answer. Check your connection and try again.',
            }),
          )
          return
        }
        resolve(res)
      })
  })

  if (ack.ok) return ack.data

  if (ack.status === 401 && !retried) {
    const token = await refreshAccessToken()
    await updateSocketToken(token)
    return socketCall<T>(event, payload, true)
  }

  throw new SocketAckError(ack.status, ack.error)
}

/**
 * What a join answers.
 *
 * `chat` is only ever present when the join asked for it with `with_chat`, and
 * even then it is OPTIONAL: the gateway reads the chat as a favour, so a read
 * that failed still leaves the subscription standing and simply omits the key.
 * It is left UNTYPED here because this file knows nothing about chat shapes —
 * `chat-api.ts` maps it with the same mapper `GET /talk/chats/:id` goes through,
 * which is exactly what the payload is a copy of.
 */
export interface JoinResult {
  ok: boolean
  /** The chat row, built from OUR side, when `withChat` was asked for. */
  chat: unknown | null
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
 * `ok: false` on `not permitted`, which means the grant lapsed: re-read the chat
 * (that re-issues it) and retry once.
 *
 * `withChat` opts into the chat body riding back on the ack, so OPENING a
 * conversation is one round trip instead of a read followed by a join. Two
 * exceptions, both deliberate:
 *
 *  - the CREATOR of a chat needs no read first — the grant is issued at creation
 *    — so this is the whole opening sequence for them;
 *  - the reconnect re-join must NOT ask for it. That path issues one join per
 *    open chat and is a pure key lookup by design; a read per room would turn a
 *    reconnect into a stampede.
 */
export function joinChatRoom(chatId: Id, withChat = false): Promise<JoinResult> {
  wantedRooms.add(chatId)
  const active = socket
  if (!active?.connected) return Promise.resolve({ ok: false, chat: null })

  return new Promise((resolve) => {
    active.emit(
      'talk:join',
      withChat ? { chat_id: chatId, with_chat: true } : { chat_id: chatId },
      (res: { ok?: boolean; chat?: unknown } | undefined) => {
        const ok = Boolean(res?.ok)
        // Both outcomes, not just the refusal. A room we are NOT in is
        // indistinguishable in the console from one nothing has been sent to,
        // and that is the first fork when "I get no messages" is reported.
        if (ok) logger.info('talk:join ok', chatId)
        else logger.warn('talk:join refused', chatId, res)
        resolve({ ok, chat: res?.chat ?? null })
      },
    )
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
  // No `with_chat` here: one join per open chat, and each one is a key lookup.
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
