import { useCallback, useMemo, useState } from 'react'
import type { Id } from '@/types/api'
import { useMembers } from '../api/use-members'
import { resolveTalkUser } from '../lib/talk-directory'
import type { ChatMember } from '../types'

/** The two panes of the Group info sheet. */
export type GroupInfoTab = 'profile' | 'members'

/** The membership change waiting on a yes — what it does, and to whom. */
export interface MemberConfirm {
  /**
   * `block` takes posting away and leaves reading; `remove` takes both.
   * `promote` hands over the same powers over the membership the owner holds,
   * and `demote` takes them back.
   */
  kind: 'add' | 'remove' | 'block' | 'unblock' | 'promote' | 'demote'
  talkUserId: Id
  name: string
}

/**
 * Everything the Group info sheet holds that isn't the rename form: which pane
 * is open, the member filter, and the membership changes.
 *
 * The member filter is deliberately CLIENT-side, unlike the directory search in
 * `use-people-picker`: `GET /talk/chats/:id/members` answers the whole group in
 * one read, so there is no page to be searching past.
 *
 * Adding, removing, the posting block and the admin role all ASK first. Either one is a write the other members
 * see immediately — a stray tap on a dense list would post a stranger into the
 * conversation, or drop somebody out of it, with nothing to undo it. So a tap
 * only opens the question; `runConfirm` is the write. `pendingIds` keeps the
 * picker row disabled while its add is in flight, so a second tap can't post the
 * same person twice, and a write that FAILS leaves the question on screen beside
 * its toast rather than closing as though it had worked.
 */
export function useGroupInfo(chatId: Id, isGroup: boolean) {
  const { members, isLoading, addMembers, removeMember, setMemberBlocked, setMemberRole } =
    useMembers(chatId, isGroup)

  const [tab, setTab] = useState<GroupInfoTab>('profile')
  const [memberQuery, setMemberQuery] = useState('')
  const [pendingIds, setPendingIds] = useState<Id[]>([])
  const [confirm, setConfirm] = useState<MemberConfirm | null>(null)
  const [isConfirming, setConfirming] = useState(false)

  const visibleMembers = useMemo(() => {
    const needle = memberQuery.trim().toLowerCase()
    if (!needle) return members
    return members.filter((member) => memberName(member).toLowerCase().includes(needle))
  }, [members, memberQuery])

  const memberIds = useMemo(() => members.map((member) => member.talkUserId), [members])

  const askAdd = useCallback((talkUserId: Id, name?: string) => {
    setConfirm({
      kind: 'add',
      talkUserId,
      name: name || resolveTalkUser(talkUserId, null, null).name,
    })
  }, [])

  const askRemove = useCallback(
    (talkUserId: Id) => {
      const member = members.find((row) => row.talkUserId === talkUserId)
      setConfirm({
        kind: 'remove',
        talkUserId,
        name: member ? memberName(member) : resolveTalkUser(talkUserId, null, null).name,
      })
    },
    [members],
  )

  const askToggleBlocked = useCallback(
    (talkUserId: Id, blocked: boolean) => {
      const member = members.find((row) => row.talkUserId === talkUserId)
      setConfirm({
        kind: blocked ? 'block' : 'unblock',
        talkUserId,
        name: member ? memberName(member) : resolveTalkUser(talkUserId, null, null).name,
      })
    },
    [members],
  )

  /**
   * Appointing or standing down an admin ASKS too, for the same reason the rest
   * do: the group is told, and an admin can go on to remove anybody but the
   * creator. The write itself is idempotent, so nothing here guards a second tap.
   */
  const askSetRole = useCallback(
    (talkUserId: Id, promote: boolean) => {
      const member = members.find((row) => row.talkUserId === talkUserId)
      setConfirm({
        kind: promote ? 'promote' : 'demote',
        talkUserId,
        name: member ? memberName(member) : resolveTalkUser(talkUserId, null, null).name,
      })
    },
    [members],
  )

  const cancelConfirm = useCallback(() => {
    if (!isConfirming) setConfirm(null)
  }, [isConfirming])

  const runConfirm = useCallback(async () => {
    if (!confirm || isConfirming) return
    const { kind, talkUserId } = confirm
    setConfirming(true)
    if (kind === 'add') {
      setPendingIds((current) =>
        current.includes(talkUserId) ? current : [...current, talkUserId],
      )
    }
    try {
      const ok =
        kind === 'add'
          ? await addMembers([talkUserId])
          : kind === 'remove'
            ? await removeMember(talkUserId)
            : kind === 'promote' || kind === 'demote'
              ? await setMemberRole(talkUserId, kind === 'promote' ? 'admin' : 'member')
              : await setMemberBlocked(talkUserId, kind === 'block')
      if (ok) setConfirm(null)
    } finally {
      setConfirming(false)
      setPendingIds((current) => current.filter((id) => id !== talkUserId))
    }
  }, [confirm, isConfirming, addMembers, removeMember, setMemberBlocked, setMemberRole])

  return {
    members,
    visibleMembers,
    memberIds,
    isLoading,
    tab,
    setTab,
    memberQuery,
    setMemberQuery,
    pendingIds,
    confirm,
    isConfirming,
    askAdd,
    askRemove,
    askToggleBlocked,
    askSetRole,
    cancelConfirm,
    runConfirm,
  }
}

/** How a member is WRITTEN — the same seam the rows draw from. */
function memberName(member: ChatMember): string {
  return resolveTalkUser(member.talkUserId, member.name, member.photo).name
}
