import type { Id } from '@/types/api'
import type { ChatMember, ChatSelf, MemberRole } from '../types'

/**
 * Who may do what to a group's membership.
 *
 * The server's rule, mirrored here so a control is never drawn that can only
 * produce a toast: `owner` and `admin` hold the same powers, and the `owner`
 * row is untouchable by everybody — the owner included, on their own row.
 *
 * Both gates read the WHOLE `self` row rather than the role alone, because a
 * left group keeps the role it was frozen at: an owner who leaves still reads
 * `member_role: 'owner'` on their own copy of the chat, while the server refuses
 * every write on it. So `hasLeft` is the first question both of them ask.
 *
 * Pure derivations only. No React, no store reads.
 */

/** What either gate needs: the role I hold, and whether I am still in the group. */
type SelfGate = Pick<ChatSelf, 'memberRole' | 'hasLeft'>

/** Add, remove, mute, and appoint further admins. NOT rename and NOT disband. */
export function canManageMembers(self: SelfGate): boolean {
  if (self.hasLeft) return false
  return self.memberRole === 'owner' || self.memberRole === 'admin'
}

/** Rename, re-picture and disband — the two powers succession does not share. */
export function canEditGroup(self: SelfGate): boolean {
  if (self.hasLeft) return false
  return self.memberRole === 'owner'
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
  self: SelfGate,
  member: Pick<ChatMember, 'talkUserId' | 'memberRole'>,
  selfTalkUserId: Id | null,
): boolean {
  if (!canManageMembers(self)) return false
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
