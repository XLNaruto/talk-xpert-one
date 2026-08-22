import { TALK_EVENT_DEDUPE_MAX_KEYS, TALK_EVENT_DEDUPE_TTL_MS } from '../constants'

/**
 * One event, applied once — for the events where applying it twice is WRONG.
 *
 * A connected client receives the same Talk event TWICE: once on the socket and
 * once as a push. That is by design, because the push is the offline path and
 * the sender cannot know whether the socket happened to be up.
 *
 * The temptation is to suppress every repeat. That is a bug, and this is the
 * rule that avoids it: **a repeat is only suppressed when the event has an
 * identity that CANNOT legitimately occur twice.** Almost every Talk event is
 * idempotent — an edit writes the same body, a delete sets the same tombstone,
 * a receipt adds a reader already in the set — so applying it a second time
 * costs nothing and converges on the same state. Meanwhile the pins and the
 * membership roles TOGGLE: pin, unpin, pin again is three real events, and the
 * first and third are indistinguishable from each other. Suppress on type and
 * id and the third one vanishes, so the message quietly stops being pinned.
 *
 * So exactly two events are de-duplicated, both of which carry an identity that
 * is minted once and never reused:
 *
 *  - `talk.message.new` — keyed on the message id. This is the one that MUST be
 *    guarded: it increments an unread count and pushes a preview, and neither
 *    survives being applied twice.
 *  - `talk.chat.created` — keyed on the chat id, because it inserts a row and
 *    triggers a join.
 *
 * NEVER key on FCM's own message id: it differs from the socket's every time.
 */

/**
 * The events worth guarding, and where each keeps its identity. Anything not
 * listed here is applied every time it arrives — see the note above.
 */
const KEYED_EVENTS: Record<string, (payload: Record<string, unknown>) => string | null> = {
  'talk.message.new': (payload) => {
    const message = payload.message as { id?: unknown } | undefined
    return message?.id == null ? null : String(message.id)
  },
  'talk.chat.created': (payload) => (payload.chat_id == null ? null : String(payload.chat_id)),
}

const seen = new Map<string, number>()

/**
 * Whether this event should be applied.
 *
 * `true` for everything unguarded, and exactly once per identity for the two
 * events that are — for as long as `TALK_EVENT_DEDUPE_TTL_MS`, which only has
 * to outlast the gap between the socket copy and the push copy.
 */
export function admitTalkEvent(type: string, payload: unknown): boolean {
  const identify = KEYED_EVENTS[type]
  if (!identify) return true
  if (typeof payload !== 'object' || payload === null) return true

  const id = identify(payload as Record<string, unknown>)
  if (id === null) return true

  const key = `${type}:${id}`
  const now = Date.now()
  const previous = seen.get(key)
  if (previous !== undefined && now - previous < TALK_EVENT_DEDUPE_TTL_MS) return false

  seen.set(key, now)
  if (seen.size > TALK_EVENT_DEDUPE_MAX_KEYS) evict(now)
  return true
}

/** Drop everything expired; failing that, the oldest half. Insertion-ordered. */
function evict(now: number) {
  for (const [key, at] of seen) {
    if (now - at >= TALK_EVENT_DEDUPE_TTL_MS) seen.delete(key)
  }
  if (seen.size <= TALK_EVENT_DEDUPE_MAX_KEYS) return
  const excess = seen.size - Math.floor(TALK_EVENT_DEDUPE_MAX_KEYS / 2)
  let dropped = 0
  for (const key of seen.keys()) {
    if (dropped >= excess) break
    seen.delete(key)
    dropped += 1
  }
}

/** Forget everything — a sign-out, so the next account starts clean. */
export function clearTalkEventDedupe(): void {
  seen.clear()
}
