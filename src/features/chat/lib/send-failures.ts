import { toApiError } from '@/lib/api-error'

/**
 * Why a send did not land, and whether replaying it could ever help.
 *
 * The distinction is what the bubble SAYS, not whether it can be resent: a
 * dropped connection is worth retrying straight away, while a refusal needs its
 * reason on screen first. Resending a refusal is still offered — the thing that
 * refused it may have changed since (I unblocked them, a mute was lifted) — but
 * the user is told what they are up against rather than left tapping.
 */
export interface SendFailure {
  /** The sentence printed under the bubble. */
  reason: string
  /** False when the server refused — replaying it would fail the same way. */
  canRetry: boolean
}

/**
 * Classify a failed send.
 *
 * `403` no longer means "somebody blocked me". Sending to a person who has
 * blocked me now SUCCEEDS — the message is stored and acknowledged like any
 * other, it just never reaches them — so nothing here may infer a block from a
 * failure, and there is no vague "could not be delivered" left to print. What
 * still refuses is the other direction and the group cases: I blocked THEM, the
 * owner muted me, I left. All are the user's own situation, all name themselves
 * in the server's message, and all are final until that situation changes.
 *
 * `404` (the chat is gone, or was never mine) and `400` (the server rejected the
 * payload) are final for the same reason. Everything else — a timeout, an
 * offline tab, a 5xx — is transport, and replays.
 */
export function sendFailure(error: unknown): SendFailure {
  const { status, message } = toApiError(error)

  if (status === 403) {
    return {
      reason: message || 'You cannot post in this conversation.',
      canRetry: false,
    }
  }
  if (status === 404) {
    return { reason: 'This conversation is no longer available.', canRetry: false }
  }
  if (status === 400 || status === 413 || status === 422) {
    return { reason: message || 'This message could not be sent.', canRetry: false }
  }
  return { reason: 'Not sent. Check your connection.', canRetry: true }
}
