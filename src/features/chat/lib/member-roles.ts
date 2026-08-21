import type { Id } from '@/types/api'
import type { ChatMember, MemberRole } from '../types'

/**
 * Who may do what to a group's membership.
 *
 * The server's rule, mirrored here so a control is never drawn that can only
 * produce a toast: `owner` and `admin` hold the same powers, and the `owner`
 * row is untouchable by everybody — the owner included, on their own row.
 *
 * Pure derivations only. No React, no store reads.
 */

/** Add, remove, mute, and appoint further admins. NOT rename and NOT disband. */
export function canManageMembers(role: MemberRole): boolean {
  return role === 'owner' || role === 'admin'
}

/** Rename, re-picture and disband — the two powers succession does not share. */
export function canEditGroup(role: MemberRole): boolean {
  return role === 'owner'
}

/**
 * Whether a row may be acted on at all — mute, remove, promote or demote.
 *
 * Three refusals collapse into one answer: the creator's row is refused to
 * everybody, my own row is refused on all three verbs (`You cannot remove
 * yourself`, `You cannot mute yourself`, `You cannot change your own role`),
 * and a plain member holds none of the powers.
 */
export function canActOnMember(
  selfRole: MemberRole,
  member: Pick<ChatMember, 'talkUserId' | 'memberRole'>,
  selfTalkUserId: Id | null,
): boolean {
  if (!canManageMembers(selfRole)) return false
  if (member.memberRole === 'owner') return false
  return member.talkUserId !== selfTalkUserId
}

/** How a role is WRITTEN on a member row. `member` wears no chip at all. */
export function roleLabel(role: MemberRole): string | null {
  if (role === 'owner') return 'Owner'
  if (role === 'admin') return 'Admin'
  return null
}

/**
 * Who inherits the group when the current owner leaves, by the server's own
 * rule: the longest-standing remaining ADMIN, else the longest-standing
 * remaining MEMBER — which in the ordinary single-admin group is the first
 * person who was added.
 *
 * Null when the leaver is the last one out. That group is left owner-less, which
 * is allowed: nothing is promoted and nothing is disbanded.
 */
export function successorOf(members: ChatMember[], leavingTalkUserId: Id | null): ChatMember | null {
  const remaining = members.filter((member) => member.talkUserId !== leavingTalkUserId)
  const byJoin = (a: ChatMember, b: ChatMember) => a.joinedAt.localeCompare(b.joinedAt)
  const admins = remaining.filter((member) => member.memberRole === 'admin').sort(byJoin)
  if (admins.length > 0) return admins[0]
  const plain = remaining.filter((member) => member.memberRole === 'member').sort(byJoin)
  return plain[0] ?? null
}
