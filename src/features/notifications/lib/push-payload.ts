import type { TalkPushEvent } from '../types'

/**
 * Pure helpers for reading an FCM payload. No React, no store reads.
 *
 * FCM flattens `data` to a STRING MAP, so every value here is a string —
 * `data.chat_id` is `"7"`, not `7`. The server works around that by ALSO sending
 * the whole event, unflattened, as one JSON string in `data.payload`: real
 * numbers, real nested objects, byte-identical to what the socket published.
 *
 * That is the only field worth reading. Parse it once and hand the result to the
 * handlers that already exist for the socket — the flat fields are for cheap
 * checks in a worker, not for building state out of.
 */

/** The flat string map FCM delivers. */
export type PushData = Record<string, string | undefined>

/**
 * Recover the socket-shaped event from a push, or null when there isn't one.
 *
 * Null is a real answer, not a failure: something other than Talk can deliver a
 * push to this origin, and a malformed one must not take the handler down.
 */
export function parsePushEvent(data: PushData | undefined | null): TalkPushEvent | null {
  if (!data) return null

  const raw = data.payload
  if (typeof raw === 'string' && raw.length > 0) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (isTalkEvent(parsed)) return parsed
    } catch {
      // Fall through to the flat fields — a truncated `payload` is still worth
      // the nudge it carries, even if the object in it is unreadable.
    }
  }

  // No `payload`: keep the one thing the flat map can be trusted for, which is
  // WHICH event and WHICH chat. Coerced, because these are strings.
  if (typeof data.type !== 'string') return null
  const chatId = Number(data.chat_id)
  return {
    type: data.type,
    ...(Number.isFinite(chatId) ? { chat_id: chatId } : {}),
  }
}

function isTalkEvent(value: unknown): value is TalkPushEvent {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  )
}

/**
 * Whether a push should draw a banner.
 *
 * Every Talk event is pushed and only some interrupt, so this is the branch that
 * decides. Branch on the BODY being present — never on a hardcoded list of event
 * names, which goes stale the moment the server adds one.
 */
export function isLoudPush(notification: { title?: string | null; body?: string | null } | undefined | null): boolean {
  return Boolean(notification?.body)
}

/** The conversation a tapped notification should open, if it names one. */
export function pushChatId(event: TalkPushEvent | null): number | null {
  if (!event) return null
  const chatId = Number(event.chat_id)
  return Number.isFinite(chatId) && chatId > 0 ? chatId : null
}
