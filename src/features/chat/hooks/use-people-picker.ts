import { useCallback, useMemo, useState } from 'react'
import { useChatListStore } from '@/stores/chat-list-store'
import { useTalkDirectoryStore } from '@/stores/talk-directory-store'
import { keyOf, type Id } from '@/types/api'
import { resolveTalkUser } from '../lib/talk-directory'

interface UsePeoplePickerOptions {
  selectedIds: Id[]
  /** Ids to hide — already in the group, or myself. */
  excludeIds?: Id[]
  onChange: (ids: Id[]) => void
  /** Free text to narrow the list by name. */
  query?: string
}

export interface PickerCandidate {
  id: Id
  name: string
  /** A storage KEY — the component runs it through `useMediaUrl()`. */
  avatarKey: string | null
  isSelected: boolean
}

/**
 * Who a group can be built from, and the two ways of choosing them.
 *
 * The Talk API still has NO directory endpoint: names and photos now ride along
 * with every id it returns, but nothing LISTS the account's Talk identities. So
 * the pool is everyone we have already seen — the counterparts of our direct
 * chats, plus anyone a chat, a member list or a message has named — and ids
 * typed in by hand from an administrator.
 *
 * The server drops ids that are not Talk identities of this account, so a typed
 * id is safe to submit: a wrong one is ignored rather than added.
 */
export function usePeoplePicker({
  selectedIds,
  excludeIds = [],
  onChange,
  query = '',
}: UsePeoplePickerOptions) {
  const chats = useChatListStore((s) => s.chats)
  const people = useTalkDirectoryStore((s) => s.people)
  const [manualId, setManualId] = useState('')
  const [manualIds, setManualIds] = useState<Id[]>([])

  // `excludeIds` is usually a fresh array each render, so key the memo on its
  // contents rather than its identity or the list rebuilds on every keystroke.
  const excludeKey = excludeIds.join(',')
  const selectedKey = selectedIds.join(',')

  const candidates = useMemo<PickerCandidate[]>(() => {
    const excluded = new Set(excludeKey ? excludeKey.split(',').map(Number) : [])
    const selected = new Set(selectedKey ? selectedKey.split(',').map(Number) : [])
    const known = chats
      .filter((chat) => chat.type === 'direct' && chat.counterpartTalkUserId !== null)
      .map((chat) => chat.counterpartTalkUserId as Id)
    // Anyone a group's member list or a message has named is choosable too —
    // a colleague we share a group with but have never messaged directly.
    const seen = Object.values(people).map((entry) => entry.talkUserId)
    const needle = query.trim().toLowerCase()

    return [...new Set([...known, ...seen, ...manualIds])]
      .filter((id) => !excluded.has(id))
      .map((id) => {
        const entry = people[keyOf(id)]
        const person = resolveTalkUser(id, entry?.name, entry?.photo)
        return {
          id,
          name: person.name,
          avatarKey: person.avatarKey,
          isSelected: selected.has(id),
        }
      })
      .filter((candidate) => !needle || candidate.name.toLowerCase().includes(needle))
  }, [chats, people, manualIds, excludeKey, selectedKey, query])

  const toggle = useCallback(
    (id: Id) => {
      onChange(
        selectedIds.includes(id)
          ? selectedIds.filter((held) => held !== id)
          : [...selectedIds, id],
      )
    },
    [onChange, selectedIds],
  )

  /** Take the typed id into the pool AND into the selection — typing it is the choice. */
  const addManual = useCallback(() => {
    const parsed = Number(manualId.trim())
    if (!Number.isInteger(parsed) || parsed <= 0) return
    setManualIds((held) => [...new Set([...held, parsed])])
    if (!selectedIds.includes(parsed)) onChange([...selectedIds, parsed])
    setManualId('')
  }, [manualId, onChange, selectedIds])

  return {
    candidates,
    toggle,
    manualId,
    /** Digits only — a Talk ID is an integer. */
    setManualId: useCallback((value: string) => setManualId(value.replace(/\D/g, '')), []),
    addManual,
  }
}
