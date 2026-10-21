import type { ChatMessage, MessageReaction } from '../types'

/**
 * Reactions, as pure arithmetic over the chips. No React, no store reads.
 *
 * Each person holds ONE reaction or none, so "my reaction" is a single emoji and
 * every rule below follows from that: picking another moves it, picking the same
 * one again takes it back.
 */

/** The emoji I have on this message, or null. At most one chip is mine. */
export function myReaction(reactions: MessageReaction[]): string | null {
  return reactions.find((chip) => chip.reactedByMe)?.emoji ?? null
}

/**
 * What a tap SENDS: the emoji, or `null` when it is the one I already have —
 * tapping my own chip (or the quick emoji I used) is how a reaction comes off.
 */
export function reactionToSend(reactions: MessageReaction[], tapped: string): string | null {
  return myReaction(reactions) === tapped ? null : tapped
}

/**
 * The chips as they will be once my reaction is `emoji` — drawn the moment I tap,
 * then replaced by the server's answer (or rolled back if it refuses).
 *
 * My old chip loses one and disappears at zero; the new one gains one, appearing
 * if nobody had used it. The order is the server's (most-used first), so a new
 * chip goes on the END rather than being guessed into place.
 */
export function withMyReaction(
  reactions: MessageReaction[],
  emoji: string | null,
): MessageReaction[] {
  const previous = myReaction(reactions)
  if (previous === emoji) return reactions

  const next = reactions
    .map((chip) =>
      chip.emoji === previous ? { ...chip, count: chip.count - 1, reactedByMe: false } : chip,
    )
    .filter((chip) => chip.count > 0)

  if (emoji === null) return next
  const target = next.find((chip) => chip.emoji === emoji)
  if (target) {
    return next.map((chip) =>
      chip.emoji === emoji ? { ...chip, count: chip.count + 1, reactedByMe: true } : chip,
    )
  }
  return [...next, { emoji, count: 1, reactedByMe: true }]
}

/**
 * Apply `talk.message.reaction_updated`.
 *
 * The event's counts replace ours outright — they are the same for everybody —
 * but it carries no `reacted_by_me`, so which chip is MINE has to be decided
 * here: kept from what the row held when somebody else reacted, or taken from
 * the event's own `emoji` when the actor is me (`null` meaning none of them).
 */
export function reactionsFromEvent(
  held: MessageReaction[],
  incoming: MessageReaction[],
  { isMine, emoji }: { isMine: boolean; emoji: string | null },
): MessageReaction[] {
  const mine = isMine ? emoji : myReaction(held)
  return incoming.map((chip) => ({ ...chip, reactedByMe: chip.emoji === mine }))
}

/**
 * Whether the react controls belong on this bubble at all.
 *
 * Never on a system line or a tombstone — the server answers both with no
 * chips and refuses a reaction — nor on a row it has not acknowledged yet,
 * which has no id to react to. Whether I may still post here (left the group,
 * muted by an admin) is the caller's half of the question.
 */
export function canReactTo(message: ChatMessage): boolean {
  return message.id > 0 && message.type !== 'system' && !message.isDeletedForEveryone
}
