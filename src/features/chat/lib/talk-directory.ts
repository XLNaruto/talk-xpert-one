import type { Id } from '@/types/api'
import type { TalkPerson } from '@/stores/talk-directory-store'
import type {
  BlockedPerson,
  Chat,
  ChatMember,
  ChatMessage,
  Contact,
  MessageReceipt,
  MessageSearchHit,
  MessageSystemData,
  PinnedMessage,
  Presence,
} from '../types'

/**
 * How a `talk_user_id` is written and drawn.
 *
 * ────────────────────────────────────────────────────────────────────
 * THE API NOW ANSWERS A NAME AND A PHOTO BESIDE EVERY PERSON.
 *
 * `name` and `photo` ride along with the id on every person-shaped field:
 * `sender_name`/`sender_photo` on a message and on its inline `reply_to`,
 * `counterpart_*` and `last_message_sender_*` and `created_by_*` on a chat row,
 * and a plain `name`/`photo` pair on a member, a receipt, a presence row and a
 * block. Both are nullable — `name` is null when the master record is gone, and
 * `photo` is a storage KEY that must go through `useMediaUrl()`, never a URL.
 *
 * So this file no longer INVENTS a label: it takes what the payload carried and
 * falls back to `Member 42` only when there was nothing. It is still the ONLY
 * place that decides how a person is written, so a change to that fallback, or
 * to how initials are derived, happens here and nowhere else.
 * ────────────────────────────────────────────────────────────────────
 */

/** What the UI needs to draw a person. */
export interface TalkUserLabel {
  talkUserId: Id
  /** What to print. */
  name: string
  /** Initials for the avatar fallback. */
  initials: string
  /** The avatar's storage KEY — pass it through `useMediaUrl()` to show it. */
  avatarKey: string | null
  /** False while the name is derived from the id rather than reported. */
  isResolved: boolean
}

/**
 * Anyone at all.
 *
 * `Member 42` is chosen over `Unknown` for a nameless record on purpose: it is
 * stable across renders, distinguishes two people in a group, and does not read
 * as an error the way a blank or a placeholder would.
 */
export function resolveTalkUser(
  talkUserId: Id,
  name?: string | null,
  photo?: string | null,
): TalkUserLabel {
  const printed = name?.trim()
  return {
    talkUserId,
    name: printed || `Member ${talkUserId}`,
    initials: printed ? initialsOf(printed) : String(talkUserId).slice(-2),
    avatarKey: photo ?? null,
    isResolved: Boolean(printed),
  }
}

/** The same, from a directory entry or a payload's person triple. */
export function personLabel(person: TalkPerson | null | undefined, fallbackId?: Id): TalkUserLabel {
  if (person) return resolveTalkUser(person.talkUserId, person.name, person.photo)
  return resolveTalkUser(fallbackId ?? 0)
}

/**
 * The signed-in person. `GET /talk/me` and the login both report your name and
 * photo now; the email's local part is the fallback, since a Talk session always
 * holds the email the credential was issued against.
 */
export function selfLabel(
  talkUserId: Id,
  name: string | null | undefined,
  photo: string | null | undefined,
  email: string | undefined,
): TalkUserLabel {
  const printed = name?.trim()
  if (printed) return resolveTalkUser(talkUserId, printed, photo)

  const local = email?.split('@')[0]?.trim()
  const derived = local ? titleCase(local.replace(/[._-]+/g, ' ')) : 'You'
  return {
    talkUserId,
    name: derived,
    initials: initialsOf(derived),
    avatarKey: photo ?? null,
    isResolved: Boolean(local),
  }
}

/** Up to two initials, for the avatar fallback. */
export function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean).slice(0, 2)
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('') || '?'
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ')
}

/* ---------------------------------------------------------------- */
/* Harvesting people out of a response                               */
/* ---------------------------------------------------------------- */

/**
 * Everyone a payload named, for `rememberPeople`.
 *
 * The directory cache exists for the two events that carry a bare id — typing
 * and presence — so every read that DOES carry names feeds it on the way past.
 * Pure: these only reshape, and the `api/` layer does the storing.
 */

function person(talkUserId: Id | null, name: string | null, photo: string | null) {
  return talkUserId === null ? null : { talkUserId, name, photo }
}

export function peopleInChat(chat: Chat): (TalkPerson | null)[] {
  return [
    person(chat.counterpartTalkUserId, chat.counterpartName, chat.counterpartPhoto),
    person(chat.createdByTalkUserId, chat.createdByName, chat.createdByPhoto),
    person(
      chat.lastMessageSenderTalkUserId,
      chat.lastMessageSenderName,
      chat.lastMessageSenderPhoto,
    ),
    // A system last message names its actor and nobody else does.
    chat.lastMessageActor
      ? person(
          chat.lastMessageActor.talkUserId,
          chat.lastMessageActor.name,
          chat.lastMessageActor.photo,
        )
      : null,
  ]
}

export function peopleInMessage(message: ChatMessage): (TalkPerson | null)[] {
  return [
    person(message.senderTalkUserId, message.senderName, message.senderPhoto),
    message.replyTo
      ? person(
          message.replyTo.senderTalkUserId,
          message.replyTo.senderName,
          message.replyTo.senderPhoto,
        )
      : null,
    // A system message has no sender, so the only names it carries are the ones
    // in its operands — the actor and the people it happened to.
    ...peopleInSystemData(message.systemData),
  ]
}

/**
 * Everyone a system message named. These are the names they had AT THE TIME, so
 * a thread of old events still seeds the directory for typing and presence when
 * nothing fresher has named them.
 */
function peopleInSystemData(data: MessageSystemData | null): (TalkPerson | null)[] {
  if (!data) return []
  return [
    data.by ? person(data.by.talkUserId, data.by.name, data.by.photo) : null,
    data.subject
      ? person(data.subject.talkUserId, data.subject.name, data.subject.photo)
      : null,
    ...data.members.map((member) => person(member.talkUserId, member.name, member.photo)),
  ]
}

export function peopleInMember(member: ChatMember): (TalkPerson | null)[] {
  return [
    person(member.talkUserId, member.name, member.photo),
    person(member.blockedByTalkUserId, member.blockedByName, member.blockedByPhoto),
  ]
}

export function peopleInReceipt(receipt: MessageReceipt): (TalkPerson | null)[] {
  return [person(receipt.talkUserId, receipt.name, receipt.photo)]
}

export function peopleInPresence(entry: Presence): (TalkPerson | null)[] {
  return [person(entry.talkUserId, entry.name, entry.photo)]
}

/**
 * The directory read — the ONE response that names people we have never
 * exchanged a message with, so it is the richest feed the cache gets.
 */
export function peopleInContact(contact: Contact): (TalkPerson | null)[] {
  return [person(contact.talkUserId, contact.name, contact.photo)]
}

export function peopleInBlock(block: BlockedPerson): (TalkPerson | null)[] {
  return [person(block.talkUserId, block.name, block.photo)]
}

export function peopleInPin(pin: PinnedMessage): (TalkPerson | null)[] {
  return [
    person(pin.pinnedByTalkUserId, pin.pinnedByName, pin.pinnedByPhoto),
    // The pin carries its message, so its author is named here too.
    ...(pin.message ? peopleInMessage(pin.message) : []),
  ]
}

export function peopleInSearchHit(hit: MessageSearchHit): (TalkPerson | null)[] {
  return [person(hit.senderTalkUserId, hit.senderName, hit.senderPhoto)]
}
